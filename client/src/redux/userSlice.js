import { createSlice } from "@reduxjs/toolkit";

const loadStoredUser = () => {
  try {
    const raw = localStorage.getItem("sp_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const userSlice = createSlice({
  name: "user",
  initialState: {
    userData: loadStoredUser(),
  },
  reducers: {
    setUserData: (state, action) => {
      state.userData = action.payload;
      try {
        if (action.payload) {
          localStorage.setItem("sp_user", JSON.stringify(action.payload));
        } else {
          localStorage.removeItem("sp_user");
        }
      } catch {
        // ignore
      }
    },
    updateCredits: (state, action) => {
      if (state.userData) {
        state.userData.credits = action.payload;
        try {
          localStorage.setItem("sp_user", JSON.stringify(state.userData));
        } catch {
          // ignore
        }
      }
    },
  },
});

export const { setUserData, updateCredits } = userSlice.actions;
export default userSlice.reducer;
