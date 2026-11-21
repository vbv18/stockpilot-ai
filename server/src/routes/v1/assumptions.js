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
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: d._id.toString(),
    version: d.version,
    orderingCost: d.orderingCost,
    holdingCost: d.holdingCost,
    holdingCostUnit: d.holdingCostUnit,
    shortagePenalty: d.shortagePenalty,
    leadTimeDays: d.leadTimeDays,
    targetServiceLevel: d.targetServiceLevel,
    holdingCostPerUnitPerDay: holdingCostDaily(d),
    provenance: d.provenance,
    confirmedAt: d.confirmedAt ? d.confirmedAt.toISOString() : null,
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
      await getSessionOwned(user.userId, params.sessionId);

      return res.status(200).json({
        data: {
          values: DEMO_ASSUMPTION_DEFAULTS,
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

      const provenance = computeProvenance(body);

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
            orderingCost: body.orderingCost,
            holdingCost: body.holdingCost,
            holdingCostUnit: body.holdingCostUnit,
            shortagePenalty: body.shortagePenalty,
            leadTimeDays: body.leadTimeDays,
            targetServiceLevel: body.targetServiceLevel,
            provenance,
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
