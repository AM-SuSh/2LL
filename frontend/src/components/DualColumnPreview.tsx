import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildRowPairs } from "../utils/dualColumn";

type Props = {
  zhText: string;
  enText: string;
  localImages?: Map<string, string>;
};

function createImageComponent(images?: Map<string, string>) {
  return ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    let resolvedSrc = src || "";
    if (images && src) {
      const localSrc = images.get(src);
      if (localSrc) {
        resolvedSrc = localSrc;
      }
    }
    return (
      <img
        {...props}
        src={resolvedSrc}
        alt={alt}
        className="md__img"
        loading="lazy"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.style.display = "none";
        }}
      />
    );
  };
}

export function DualColumnPreview({ zhText, enText, localImages }: Props) {
  const rows = buildRowPairs(zhText, enText);
  if (rows.length === 0) {
    return <div className="previewEmpty">暂无可预览内容</div>;
  }

  return (
    <div className="pairGrid">
      <div className="pairGrid__header">
        <div className="pairGrid__head">中文</div>
        <div className="pairGrid__head">English</div>
      </div>
      {rows.map((row, idx) => {
        const rowClass = row.type === "heading" ? "pairRow pairRow--heading" : "pairRow";
        return (
          <div className={rowClass} key={`pair-${idx}`}>
            <div className="pairCell pairCell--zh">
              <div className="pairCell__index">#{idx + 1}</div>
              <div className="pairCell__content md">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: createImageComponent(localImages),
                  }}
                >
                  {row.zh || "—"}
                </ReactMarkdown>
              </div>
            </div>
            <div className="pairCell pairCell--en">
              <div className="pairCell__index">#{idx + 1}</div>
              <div className="pairCell__content md">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: createImageComponent(localImages),
                  }}
                >
                  {row.en || "—"}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
