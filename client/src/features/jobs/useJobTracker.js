import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { stockpilotApi, useGetJobQuery } from "../../lib/api.js";

export function useJobTracker(sessionId, jobId, onFinished) {
  const dispatch = useDispatch();
  const finishedRef = useRef(false);

  const { data: job, error } = useGetJobQuery(
    { sessionId, jobId },
    {
      skip: !sessionId || !jobId,
      pollingInterval: 1500,
    },
  );

  const isActive = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (
      jobId &&
      job &&
      ["succeeded", "failed", "cancelled"].includes(job.status)
    ) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        // Invalidate tags
        dispatch(
          stockpilotApi.util.invalidateTags([
            { type: "Session", id: sessionId },
            { type: "Dataset", id: sessionId },
            { type: "Forecast", id: sessionId },
            { type: "Optimization", id: sessionId },
            { type: "Simulations", id: sessionId },
          ]),
        );
        if (onFinished) {
          onFinished(job);
        }
      }
    }
  }, [job, jobId, sessionId, dispatch, onFinished]);

  return { job, isActive, error };
}
