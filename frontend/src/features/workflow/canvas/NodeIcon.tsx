import { Braces, CheckSquare, ClipboardList, FileInput, GitBranch, GitMerge, RotateCw, Sparkles, Table2 } from "lucide-react";
import type { WorkflowNodeKind } from "../types";

export function NodeIcon({ kind }: { kind: WorkflowNodeKind }) {
  if (kind === "input") return <FileInput size={17} />;
  if (kind === "classifier") return <ClipboardList size={17} />;
  if (kind === "branch") return <GitBranch size={17} />;
  if (kind === "kie") return <Sparkles size={17} />;
  if (kind === "required-checker") return <CheckSquare size={17} />;
  if (kind === "table") return <Table2 size={17} />;
  if (kind === "rotation") return <RotateCw size={17} />;
  if (kind === "merge") return <GitMerge size={17} />;
  return <Braces size={17} />;
}
