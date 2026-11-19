import { useState, useRef } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { AlertCircle, FileText, UploadCloud, X } from "lucide-react";
import { uploadWithProgress } from "../../lib/apiClient.js";
import { usePutMappingMutation } from "../../lib/api.js";
import { JobProgress } from "../jobs/JobProgress.jsx";
import { useJobTracker } from "../jobs/useJobTracker.js";
import { ColumnMappingPanel } from "./ColumnMappingPanel.jsx";

const MAX_UPLOAD_MB = Number(import.meta.env.VITE_UPLOAD_MAX_MB) || 60;

export default function UploadPage() {
  const { session } = useOutletContext();
  const navigate = useNavigate();

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const abortCtrlRef = useRef(null);

  // Uploaded dataset metadata from server
  const [uploadResult, setUploadResult] = useState(null);

  // Validation job tracking
  const [jobId, setJobId] = useState(() => {
    return sessionStorage.getItem(`sp:job:${session.id}:validation`) || null;
  });

  const { job } = useJobTracker(session.id, jobId, (finishedJob) => {
    sessionStorage.removeItem(`sp:job:${session.id}:validation`);
    if (finishedJob.status === "succeeded") {
      navigate(`/sessions/${session.id}/validation`);
    }
  });

  const [putMapping, { isLoading: isSubmittingMapping }] = usePutMappingMutation();

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setUploadError("Only CSV files (.csv) are accepted.");
      return;
    }

    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(`File exceeds the maximum allowed size of ${MAX_UPLOAD_MB} MB.`);
      return;
    }

    setUploadError("");
    setSelectedFile(file);
    startUpload(file);
  };

  const startUpload = async (file) => {
    setIsUploading(true);
    setUploadPct(0);
    setUploadError("");

    abortCtrlRef.current = new AbortController();

    try {
      const data = await uploadWithProgress(
        `/sessions/${session.id}/dataset`,
        file,
        (pct) => setUploadPct(pct),
        abortCtrlRef.current.signal,
      );
      setUploadResult(data);
    } catch (err) {
      if (err.code !== "JOB_CANCELLED") {
        setUploadError(err.message || "Upload failed. Please try again.");
      }
      setSelectedFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancelUpload = () => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
    }
    setIsUploading(false);
    setSelectedFile(null);
  };

  const handleMappingSubmit = async (mappingPayload) => {
    try {
      const res = await putMapping({
        id: session.id,
        body: mappingPayload,
      }).unwrap();

      const newJobId = res.jobId;
      setJobId(newJobId);
      sessionStorage.setItem(`sp:job:${session.id}:validation`, newJobId);
    } catch (err) {
      setUploadError(err.data?.message || err.message || "Failed to start validation.");
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Upload Dataset</h2>
        <p className="text-xs text-slate-400 mt-1">
          Upload your historical sales records in CSV format. Daily observations are required to forecast lead-time demand.
        </p>
      </div>

      {uploadError && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {jobId && <JobProgress sessionId={session.id} job={job} />}

      {!uploadResult && !isUploading && (
        <div className="bg-[#13151c] border border-dashed border-white/[0.12] hover:border-indigo-500/40 rounded-2xl p-10 flex flex-col items-center justify-center gap-3 text-center transition-colors">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <UploadCloud size={24} />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-200">Select sales CSV file</h3>
            <p className="text-xs text-slate-500 mt-0.5">Maximum size: {MAX_UPLOAD_MB} MB</p>
          </div>

          <label className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold rounded-xl text-white cursor-pointer shadow-md shadow-indigo-700/20 transition-all">
            Browse File
            <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
          </label>
        </div>
      )}

      {isUploading && selectedFile && (
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-200 font-medium">
              <FileText size={16} className="text-indigo-400" />
              <span>{selectedFile.name}</span>
              <span className="text-slate-500 font-mono">({Math.round(selectedFile.size / 1024)} KB)</span>
            </div>
            <button
              type="button"
              onClick={handleCancelUpload}
              className="text-slate-400 hover:text-slate-200 p-1"
              title="Cancel upload"
            >
              <X size={14} />
            </button>
          </div>

          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-200"
              style={{ width: `${uploadPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Uploading to storage...</span>
            <span>{uploadPct}%</span>
          </div>
        </div>
      )}

      {uploadResult && (
        <div className="flex flex-col gap-6">
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <FileText size={16} />
              </div>
              <div>
                <span className="font-semibold text-slate-200">{uploadResult.originalName}</span>
                <p className="text-slate-500 text-[11px]">
                  {uploadResult.columns.length} columns detected · delimiter &apos;{uploadResult.delimiter}&apos; · {uploadResult.encoding}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setUploadResult(null);
                setSelectedFile(null);
              }}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
            >
              Replace file
            </button>
          </div>

          <ColumnMappingPanel
            columns={uploadResult.columns}
            preview={uploadResult.preview}
            initialMapping={uploadResult.suggestedMapping}
            onSubmit={handleMappingSubmit}
            isLoading={isSubmittingMapping || (job && (job.status === "queued" || job.status === "running"))}
          />
        </div>
      )}
    </div>
  );
}
