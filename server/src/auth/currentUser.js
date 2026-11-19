import { AppError } from "../lib/errors.js";
import UserModel from "../models/user.model.js";

export function attachUser() {
  return async (req, res, next) => {
    try {
      const userProp = req.user;
      const firebaseUid = userProp?.firebaseUid;
      const email = userProp?.email || null;

      if (!firebaseUid) {
        throw new AppError("UNAUTHENTICATED", "Authentication required");
      }

      const userDoc = await UserModel.findOneAndUpdate(
        { firebaseUid },
        { $setOnInsert: { firebaseUid, email } },
        { upsert: true, new: true },
      );

      res.locals.user = {
        userId: userDoc._id.toString(),
        firebaseUid: userDoc.firebaseUid,
        email: userDoc.email || null,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function getUser(res) {
  const user = res.locals?.user;
  if (!user || !user.userId) {
    throw new AppError("UNAUTHENTICATED", "Authentication required");
  }
  return user;
}
