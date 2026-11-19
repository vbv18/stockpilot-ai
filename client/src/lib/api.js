import { createApi } from "@reduxjs/toolkit/query/react";
import { apiFetch } from "./apiClient.js";

const customBaseQuery = async ({ url, method = "GET", body }) => {
  try {
    const result = await apiFetch(url, { method, body });
    return { data: result.data, meta: result.meta };
  } catch (err) {
    return {
      error: {
        status: err.status || 500,
        code: err.code || "INTERNAL_ERROR",
        message: err.message || "An unexpected error occurred.",
        requestId: err.requestId || null,
        details: err.details,
      },
    };
  }
};

export const stockpilotApi = createApi({
  reducerPath: "stockpilotApi",
  baseQuery: customBaseQuery,
  tagTypes: [
    "Sessions",
    "Session",
    "Job",
    "Dataset",
    "Forecast",
    "Assumptions",
    "Optimization",
    "Simulations",
    "Simulation",
    "AiSessions",
    "Conversation",
    "Messages",
  ],
  endpoints: (builder) => ({
    listSessions: builder.query({
      query: ({ page = 1, limit = 20, archived = false } = {}) => ({
        url: `/sessions?page=${page}&limit=${limit}&archived=${archived}`,
        method: "GET",
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Session", id })),
              { type: "Sessions", id: "LIST" },
            ]
          : [{ type: "Sessions", id: "LIST" }],
      transformResponse: (response) => {
        // Return both items and meta if available
        return response;
      },
    }),

    createSession: builder.mutation({
      query: ({ name } = {}) => ({
        url: "/sessions",
        method: "POST",
        body: { name },
      }),
      invalidatesTags: [{ type: "Sessions", id: "LIST" }],
    }),

    getSession: builder.query({
      query: (id) => ({
        url: `/sessions/${id}`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Session", id }],
    }),

    patchSession: builder.mutation({
      query: ({ id, name, archived }) => ({
        url: `/sessions/${id}`,
        method: "PATCH",
        body: { name, archived },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Session", id },
        { type: "Sessions", id: "LIST" },
      ],
    }),

    putMapping: builder.mutation({
      query: ({ id, body }) => ({
        url: `/sessions/${id}/dataset/mapping`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Session", id },
        { type: "Dataset", id },
      ],
    }),

    getValidation: builder.query({
      query: (id) => ({
        url: `/sessions/${id}/dataset/validation`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Dataset", id }],
    }),

    confirmDataset: builder.mutation({
      query: ({ id, body }) => ({
        url: `/sessions/${id}/dataset/confirm`,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Session", id },
        { type: "Dataset", id },
      ],
    }),

    getJob: builder.query({
      query: ({ sessionId, jobId }) => ({
        url: `/sessions/${sessionId}/jobs/${jobId}`,
        method: "GET",
      }),
      providesTags: (result, error, { jobId }) => [{ type: "Job", id: jobId }],
    }),

    cancelJob: builder.mutation({
      query: ({ sessionId, jobId }) => ({
        url: `/sessions/${sessionId}/jobs/${jobId}/cancel`,
        method: "POST",
      }),
      invalidatesTags: (result, error, { jobId, sessionId }) => [
        { type: "Job", id: jobId },
        { type: "Session", id: sessionId },
      ],
    }),

    startForecast: builder.mutation({
      query: ({ id, seed }) => ({
        url: `/sessions/${id}/forecast`,
        method: "POST",
        body: seed !== undefined ? { seed } : {},
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Session", id },
        { type: "Forecast", id },
      ],
    }),

    getForecast: builder.query({
      query: (id) => ({
        url: `/sessions/${id}/forecast`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Forecast", id }],
    }),

    getAssumptionDefaults: builder.query({
      query: (id) => ({
        url: `/sessions/${id}/assumptions/defaults`,
        method: "GET",
      }),
    }),

    listAssumptions: builder.query({
      query: (id) => ({
        url: `/sessions/${id}/assumptions`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Assumptions", id }],
    }),

    createAssumptions: builder.mutation({
      query: ({ id, body }) => ({
        url: `/sessions/${id}/assumptions`,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Session", id },
        { type: "Assumptions", id },
        { type: "Optimization", id },
      ],
    }),

    startOptimization: builder.mutation({
      query: (id) => ({
        url: `/sessions/${id}/optimize`,
        method: "POST",
        body: {},
      }),
      invalidatesTags: (result, error, id) => [
        { type: "Session", id },
        { type: "Optimization", id },
      ],
    }),

    getOptimization: builder.query({
      query: (id) => ({
        url: `/sessions/${id}/optimization`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Optimization", id }],
    }),

    startSimulation: builder.mutation({
      query: ({ id, body }) => ({
        url: `/sessions/${id}/simulations`,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Session", id },
        { type: "Simulations", id },
      ],
    }),

    listSimulations: builder.query({
      query: (id) => ({
        url: `/sessions/${id}/simulations`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Simulations", id }],
    }),

    getSimulation: builder.query({
      query: ({ id, simulationId }) => ({
        url: `/sessions/${id}/simulations/${simulationId}`,
        method: "GET",
      }),
      providesTags: (result, error, { simulationId }) => [{ type: "Simulation", id: simulationId }],
    }),
  }),
});

export const {
  useListSessionsQuery,
  useCreateSessionMutation,
  useGetSessionQuery,
  usePatchSessionMutation,
  usePutMappingMutation,
  useGetValidationQuery,
  useConfirmDatasetMutation,
  useGetJobQuery,
  useCancelJobMutation,
  useStartForecastMutation,
  useGetForecastQuery,
  useGetAssumptionDefaultsQuery,
  useListAssumptionsQuery,
  useCreateAssumptionsMutation,
  useStartOptimizationMutation,
  useGetOptimizationQuery,
  useStartSimulationMutation,
  useListSimulationsQuery,
  useGetSimulationQuery,
} = stockpilotApi;
