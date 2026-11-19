import { Router } from "express";
import { z } from "zod";
import { getUser } from "../../auth/currentUser.js";
import { PaginationQuery } from "../../contracts/common.js";
import { IdParam, SessionCreateBody, SessionPatchBody } from "../../contracts/pipeline.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { createSession, getSessionOwned, listSessions, toSessionDto } from "../../services/sessionService.js";

const router = Router();

// POST /sessions
router.post(
  "/",
  validate({ body: SessionCreateBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { body } = getValidated(res);
      const session = await createSession(user.userId, body.name);
      return res.status(201).json({ data: toSessionDto(session) });
    } catch (err) {
      next(err);
    }
  },
);

// GET /sessions
const ListQuery = PaginationQuery.extend({
  archived: z.enum(["true", "false"]).default("false"),
});

router.get(
  "/",
  validate({ query: ListQuery }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { query } = getValidated(res);
      const archived = query.archived === "true";
      const { items, total } = await listSessions(user.userId, {
        page: query.page,
        limit: query.limit,
        archived,
      });
      return res.status(200).json({
        data: items.map(toSessionDto),
        meta: { page: query.page, limit: query.limit, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /sessions/:sessionId
router.get(
  "/:sessionId",
  validate({ params: IdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);
      return res.status(200).json({ data: toSessionDto(session) });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /sessions/:sessionId
router.patch(
  "/:sessionId",
  validate({ params: IdParam, body: SessionPatchBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, body } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      if (body.name !== undefined) {
        session.name = body.name.trim();
      }
      if (body.archived !== undefined) {
        session.archivedAt = body.archived ? new Date() : null;
      }
      await session.save();

      return res.status(200).json({ data: toSessionDto(session) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
