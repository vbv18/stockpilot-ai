import UserModel from "../models/user.model.js";

export async function findOneUser({
  userId = "",
  firebaseUid = "",
  email = "",
}) {
  const query = {};

  if (userId) query._id = userId;
  if (firebaseUid) query.firebaseUid = firebaseUid;
  if (email) query.email = email;

  if (Object.keys(query).length === 0) {
    return null;
  }

  return await UserModel.findOne(query);
}

export async function createUser({ firebaseUid, name, email, avatar }) {
  const user = await UserModel.create({
    firebaseUid,
    name,
    email,
    avatar,
  });

  return user;
}
