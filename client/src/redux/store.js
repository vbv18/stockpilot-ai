import { configureStore } from "@reduxjs/toolkit";
import userReducer from "./userSlice.js";
import { stockpilotApi } from "../lib/api.js";

export const store = configureStore({
  reducer: {
    user: userReducer,
    [stockpilotApi.reducerPath]: stockpilotApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(stockpilotApi.middleware),
});
