import { Router } from "express";
import { z } from "zod";
import { getUser } from "../../auth/currentUser.js";
import { DEMO_ASSUMPTION_DEFAULTS } from "../../config/constants.js";
import {
  AssumptionsBody,
  computeProvenance,
  holdingCostDaily,
  IdParam,
} from "../../contracts/pipeline.js";
import { AppError } from "../../lib/errors.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { AssumptionSetModel } from "../../models/assumptionSet.model.js";
import { DatasetModel } from "../../models/dataset.model.js";
import { ForecastRunModel } from "../../models/forecastRun.model.js";
import { enqueueJob } from "../../services/jobRunner.js";
import {
  getSessionOwned,
  requireStatus,
  setStage,
  transition,
} from "../../services/sessionService.js";
import { ACTION_ALLOWED_FROM } from "../../services/stateMachine.js";

const router = Router({ mergeParams: true });

function toAssumptionSetDto(doc) {
  const d = doc.toObject ? doc.toObject({ flattenMaps: true }) : doc;
  const skusObj =
    d.skus instanceof Map ? Object.fromEntries(d.skus) : d.skus || {};
  return {
    id: d._id ? d._id.toString() : d.id,
    version: d.version,
    skus: skusObj,
    skusList: Object.values(skusObj),
    provenance: d.provenance || {},
    budget: d.budget ?? null,
    capacity: d.capacity ?? null,
    confirmedAt: d.confirmedAt
      ? d.confirmedAt.toISOString
        ? d.confirmedAt.toISOString()
        : d.confirmedAt
      : null,
  };
}

// GET /sessions/:sessionId/assumptions/defaults
router.get(
  "/defaults",
  validate({ params: IdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      let skuIds = [];
      if (session.activeDatasetId) {
        const dataset = await DatasetModel.findOne({
          _id: session.activeDatasetId,
          userId: user.userId,
        });
        skuIds =
          dataset?.transformationConfig?.skuIds ||
          dataset?.validationSummary?.skuIds ||
          [];
      }
      if (skuIds.length === 0 && session.activeForecastRunId) {
        const forecastRun = await ForecastRunModel.findOne({
          _id: session.activeForecastRunId,
          userId: user.userId,
        });
        skuIds = (forecastRun?.result?.forecast?.skus || []).map(
          (s) => s.sku_id,
        );
      }

      const defaultSkuValues = {
        unit_cost: DEMO_ASSUMPTION_DEFAULTS.unit_cost,
        order_cost: DEMO_ASSUMPTION_DEFAULTS.order_cost,
        holding_rate: DEMO_ASSUMPTION_DEFAULTS.holding_rate,
        shortage_cost: DEMO_ASSUMPTION_DEFAULTS.shortage_cost,
        lead_time_mean: DEMO_ASSUMPTION_DEFAULTS.lead_time_mean,
        lead_time_std: DEMO_ASSUMPTION_DEFAULTS.lead_time_std ?? 0,
        target_service_level: DEMO_ASSUMPTION_DEFAULTS.target_service_level,
        moq: DEMO_ASSUMPTION_DEFAULTS.moq ?? 1,
        pack_size: DEMO_ASSUMPTION_DEFAULTS.pack_size ?? 1,
        initial_stock: DEMO_ASSUMPTION_DEFAULTS.initial_stock ?? 0,
      };

      const skus = {};
      const skusList = [];
      for (const skuId of skuIds) {
        const item = { sku_id: skuId, ...defaultSkuValues };
        skus[skuId] = item;
        skusList.push(item);
      }

      return res.status(200).json({
        data: {
          skuIds,
          skus,
          skusList,
          values: defaultSkuValues,
          label:
            "Illustrative demonstration values. Replace them with your own costs and lead time.",
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /sessions/:sessionId/assumptions
router.post(
  "/",
  validate({ params: IdParam, body: AssumptionsBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, body } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      requireStatus(session, ACTION_ALLOWED_FROM.assumptions);

      let expectedSkuIds = [];
      if (session.activeDatasetId) {
        const dataset = await DatasetModel.findOne({
          _id: session.activeDatasetId,
          userId: user.userId,
        });
        expectedSkuIds =
          dataset?.transformationConfig?.skuIds ||
          dataset?.validationSummary?.skuIds ||
          [];
      }
      if (expectedSkuIds.length === 0 && session.activeForecastRunId) {
        const forecastRun = await ForecastRunModel.findOne({
          _id: session.activeForecastRunId,
          userId: user.userId,
        });
        expectedSkuIds = (forecastRun?.result?.forecast?.skus || []).map(
          (s) => s.sku_id,
        );
      }

      const skusMap = {};
      if (Array.isArray(body.skus)) {
        for (const item of body.skus) {
          skusMap[item.sku_id] = {
            ...item,
            ordering_cost: item.order_cost,
            shortage_penalty: item.shortage_cost,
            service_level: item.target_service_level,
            holding_rate:
              item.holding_rate <= 1.0
                ? item.holding_rate
                : Math.min(1.0, item.holding_rate / (item.unit_cost || 1)),
            holding_cost_annual:
              item.holding_rate <= 1.0
                ? item.holding_rate * item.unit_cost
                : item.holding_rate,
          };
        }
      } else {
        for (const [skuId, item] of Object.entries(body.skus)) {
          const sku_id = item.sku_id || skuId;
          skusMap[skuId] = {
            ...item,
            sku_id,
            ordering_cost: item.order_cost,
            shortage_penalty: item.shortage_cost,
            service_level: item.target_service_level,
            holding_rate:
              item.holding_rate <= 1.0
                ? item.holding_rate
                : Math.min(1.0, item.holding_rate / (item.unit_cost || 1)),
            holding_cost_annual:
              item.holding_rate <= 1.0
                ? item.holding_rate * item.unit_cost
                : item.holding_rate,
          };
        }
      }

      for (const skuId of expectedSkuIds) {
        if (!skusMap[skuId]) {
          throw new AppError(
            "UNPROCESSABLE_ENTITY",
            `Missing assumptions for SKU ${skuId}. Every SKU in the session requires all fields.`,
          );
        }
      }

      const provenance = computeProvenance(skusMap);

      // Retry loop on version duplicate key
      let assumptionDoc = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const latest = await AssumptionSetModel.findOne({
          sessionId: params.sessionId,
        }).sort({ version: -1 });

        const nextVersion = latest ? latest.version + 1 : 1;

        try {
          assumptionDoc = await AssumptionSetModel.create({
            userId: user.userId,
            sessionId: params.sessionId,
            version: nextVersion,
            skus: skusMap,
            provenance,
            budget: body.budget ?? null,
            capacity: body.capacity ?? null,
            confirmedAt: new Date(),
          });
          break;
        } catch (err) {
          if (err.code === 11000) {
            continue;
          }
          throw err;
        }
      }

      if (!assumptionDoc) {
        throw new AppError(
          "CONFLICT",
          "Could not allocate next assumption set version",
        );
      }

      session.activeAssumptionSetId = assumptionDoc._id;
      if (body.budget !== undefined) {
        session.budget = body.budget;
      }
      if (body.capacity !== undefined) {
        session.capacity = body.capacity;
      }
      await session.save();

      await transition(user.userId, params.sessionId, "assumptions_pending");

      return res.status(201).json({
        data: toAssumptionSetDto(assumptionDoc),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /sessions/:sessionId/assumptions
router.get("/", validate({ params: IdParam }), async (req, res, next) => {
  try {
    const user = getUser(res);
    const { params } = getValidated(res);
    await getSessionOwned(user.userId, params.sessionId);

    const sets = await AssumptionSetModel.find({
      sessionId: params.sessionId,
      userId: user.userId,
    }).sort({ version: -1 });

    return res.status(200).json({
      data: sets.map(toAssumptionSetDto),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
export { toAssumptionSetDto };
