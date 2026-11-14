// Role 3's terrain model check (model_check.md) on the About page, turned into headings, paragraphs and lists by a
// tiny Markdown reader. Text goes in through React, never as HTML, so the file can't inject anything into the page.
import { loadModelCheck } from "../data/api.js";
import { useLoaded } from "../data/useLoaded.js";

/** Role 3's model_check.md as headings, paragraphs and bullet lists (rendered by React, never as HTML). */
export default function ModelCheck() {
  const { data: text, isLoading } = useLoaded(() => loadModelCheck(), []);

  if (isLoading) return <p className="about-text" role="status">Loading the terrain model check…</p>;
  // A dev server answers a missing file with its index.html page, which is not the model check either.
  const isPublished = typeof text === "string" && !/^\s*<(!doctype|html)/i.test(text);
  const blocks = isPublished ? toTextBlocks(text) : [];
  if (blocks.length === 0) {
    return <p className="about-text">The terrain model check will appear here once Role 3 publishes it.</p>;
  }

  return (
    <div className="about-model-check">
      {blocks.map((block, index) => {
        if (block.type === "heading") return <h3 key={index} className="about-model-check-heading">{block.text}</h3>;
        if (block.type === "list") return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}

/** Plain Markdown to blocks: "# " lines are headings, "- " lines list items, other lines join into paragraphs; blank lines split them. */
function toTextBlocks(text) {
  const blocks = [];
  let openBlock = null; // the paragraph or list that the next line can extend
  for (const rawLine of text.split(/\r?\n/)) {
    const line = toPlainText(rawLine.trim());
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (line === "" || heading) {
      openBlock = null;
      if (heading) blocks.push({ type: "heading", text: heading[1] });
    } else if (listItem) {
      if (openBlock?.type !== "list") {
        openBlock = { type: "list", items: [] };
        blocks.push(openBlock);
      }
      openBlock.items.push(listItem[1]);
    } else if (openBlock?.type === "paragraph") {
      openBlock.text += ` ${line}`;
    } else {
      openBlock = { type: "paragraph", text: line };
      blocks.push(openBlock);
    }
  }
  return blocks;
}

/** Drops bold and code marks and keeps only the words of [links](url), so the text reads cleanly. */
function toPlainText(line) {
  return line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*|__|`/g, "");
}
