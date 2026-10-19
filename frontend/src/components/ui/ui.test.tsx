import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DialogProvider, useConfirm } from "./Dialog";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("failed는 danger tone, null은 대시", () => {
    const { rerender } = render(<StatusBadge status="failed" />);
    expect(screen.getByText("실패")).toHaveAttribute("data-tone", "danger");
    rerender(<StatusBadge status={null} />);
    expect(screen.getByText("–")).toBeInTheDocument();
  });
});

function ConfirmProbe({ onResult }: { onResult: (value: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={() => void confirm({ title: "삭제할까요?" }).then(onResult)}>
      열기
    </button>
  );
}

describe("useConfirm", () => {
  it("확인을 누르면 true, Esc면 false로 끝난다", async () => {
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <ConfirmProbe onResult={(value) => results.push(value)} />
      </DialogProvider>
    );
    fireEvent.click(screen.getByText("열기"));
    expect(screen.getByRole("dialog", { name: "삭제할까요?" })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "확인" })));
    fireEvent.click(screen.getByText("열기"));
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect(results).toEqual([true, false]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
