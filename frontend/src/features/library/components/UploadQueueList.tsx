import { uploadQueueStatusLabel, type UploadQueueItem } from "../model";

export function UploadQueueList(props: { items: UploadQueueItem[] }) {
  if (!props.items.length) return null;
  return (
    <div className="document-upload-queue">
      <div>
        <strong>업로드 대기</strong>
        <span>업로드 중에도 파일이나 폴더를 계속 추가할 수 있습니다.</span>
      </div>
      {props.items.map((item) => (
        <div key={item.id} className={`document-upload-queue-row ${item.status}`}>
          <div>
            <strong>{item.label}</strong>
            <span>
              {item.uploadedCount.toLocaleString()} / {item.files.length.toLocaleString()} 업로드
              {item.error ? ` · ${item.error}` : ""}
            </span>
          </div>
          <small>{uploadQueueStatusLabel(item.status)}</small>
        </div>
      ))}
    </div>
  );
}
