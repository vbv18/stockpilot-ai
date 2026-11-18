import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      unique: true,
      sparse: true,
    },
    name: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      index: true,
      lowercase: true,
      trim: true,
    },
    avatar: String,
  },
  {
    timestamps: true,
  },
);

const UserModel = mongoose.model("users", userSchema);

export default UserModel;
