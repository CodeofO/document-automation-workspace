// 짧은 값 목록(choice 허용 값, checkbox 칸 이름) 입력. Enter·쉼표로 추가, ×·Backspace로 삭제.
import { X } from "lucide-react";
import { useState } from "react";
import { parseTags } from "../model/template";

export function TagInput(props: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");

  function commit(raw: string) {
    const added = parseTags(raw).filter((tag) => !props.values.includes(tag));
    if (added.length) props.onChange([...props.values, ...added]);
    setText("");
  }

  return (
    <div className="table-tag-input" role="group" aria-label={props.label}>
      {props.values.map((value) => (
        <span key={value} className="table-tag">
          {value}
          <button
            type="button"
            aria-label={`${value} 빼기`}
            onClick={() => props.onChange(props.values.filter((item) => item !== value))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        aria-label={props.label}
        value={text}
        placeholder={props.values.length ? "" : (props.placeholder ?? "입력 후 Enter")}
        onChange={(event) => {
          const next = event.target.value;
          if (/[,\n]/.test(next)) commit(next);
          else setText(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(text);
          } else if (event.key === "Backspace" && !text && props.values.length) {
            props.onChange(props.values.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && commit(text)}
      />
    </div>
  );
}
