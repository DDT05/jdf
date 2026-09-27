import { For, Show } from "solid-js";
import type { TableElement, Style, TableCellValue, TableBorders, TextAlign } from "@jdf/core";
import { MM_TO_PX } from "@jdf/core";
import { resolveStyle, styleToCss } from "./PageRenderer";
import { Editable } from "../shared/Editable";
import { useEdit, type ElementPath } from "../../edit/context";

interface TableElementViewProps {
  element: TableElement;
  path: ElementPath;
  styles: Record<string, Style>;
}

function cellText(c: TableCellValue): string {
  // Tolerate malformed cells (null, numbers, missing content) — keep the web
  // embed (jdf.js) and reader byte-identical in leniency so the same document
  // renders the same rows on both surfaces.
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (typeof c === "object") return c.content == null ? "" : String(c.content);
  return String(c);
}

function cellAttrs(c: TableCellValue) {
  if (c == null || typeof c !== "object") return {};
  return { colspan: c.colspan, rowspan: c.rowspan };
}

function cellAlign(c: TableCellValue): TextAlign | undefined {
  return c == null || typeof c !== "object" ? undefined : c.align;
}

/** Normalise a column width (number → px, string passed through, e.g. "30%"). */
function colWidthCss(w: string | number | undefined): string | undefined {
  if (w == null) return undefined;
  return typeof w === "number" ? `${w * MM_TO_PX}px` : w;
}

export function TableElementView(props: TableElementViewProps) {
  const edit = useEdit();
  // `style.fontSize` / `lineHeight` size the cells and `style.padding` is the
  // cell padding (the PDF importer writes compact values so a converted
  // statement occupies the same box as the source rows). Same rules as
  // jdf.js's renderTable — keep them identical.
  const css = () => resolveStyle(props.element.style, props.styles);
  const cellPad = () => css()["padding"] ?? "8px 12px";
  const wrapCss = () => { const { padding: _p, ...rest } = css(); return rest; };

  const headerCss = () => {
    const s = props.element.headerStyle;
    if (!s) return {};
    if (typeof s === "string") return styleToCss(props.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(props.styles[k] || {}) }; return m; }
    return styleToCss(s);
  };

  const rowCss = () => {
    const s = props.element.rowStyle;
    if (!s) return {};
    if (typeof s === "string") return styleToCss(props.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(props.styles[k] || {}) }; return m; }
    return styleToCss(s);
  };

  const altRowCss = () => {
    const s = props.element.alternateRowStyle;
    if (!s) {
      const c = props.element.alternatingRowColor;
      return c ? { "background-color": c } : {};
    }
    if (typeof s === "string") return styleToCss(props.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(props.styles[k] || {}) }; return m; }
    return styleToCss(s);
  };

  const borders = (): TableBorders => {
    const b = props.element.borders;
    if (b === false) return { outer: false, inner: false };
    if (b === true || b === undefined) return { outer: true, inner: true, color: "#e2e8f0", width: 1 };
    return { outer: true, inner: true, color: "#e2e8f0", width: 1, ...b };
  };

  // Keep header indices aligned with columns: filtering out empty headers
  // shifted every later index, so editing header 2 wrote to column 1.
  const headers = () => {
    if (props.element.headers) return props.element.headers;
    const fromCols = props.element.columns?.map((c) => c.header || "");
    return fromCols && fromCols.some((h) => h !== "") ? fromCols : undefined;
  };

  function commitHeader(i: number, value: string) {
    // `headers` may be derived from `columns[*].header`; write back to where
    // the value actually lives instead of conjuring a `headers` *object*.
    if (props.element.headers) edit.updateField(props.path, `headers.${i}`, value);
    else edit.updateField(props.path, `columns.${i}.header`, value);
  }

  const hasColWidths = () => props.element.columns?.some((c) => c.width != null) ?? false;

  const cellCss = (c: TableCellValue) => {
    if (c == null || typeof c !== "object" || !c.style) return {};
    const s = c.style;
    if (typeof s === "string") return styleToCss(props.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(props.styles[k] || {}) }; return m; }
    return styleToCss(s);
  };

  function commitCell(rowIdx: number, colIdx: number, value: string) {
    const row = props.element.rows[rowIdx];
    if (!row) return;
    const cell = row[colIdx];
    if (typeof cell === "string" || cell == null) {
      edit.updateField(props.path, `rows.${rowIdx}.${colIdx}`, value);
    } else {
      edit.updateField(props.path, `rows.${rowIdx}.${colIdx}.content`, value);
    }
  }

  return (
    <div style={wrapCss()} class="overflow-x-auto">
      <table
        class="w-full border-collapse"
        style={{
          "font-size": css()["font-size"] || "14px",
          ...(css()["line-height"] ? { "line-height": css()["line-height"] } : {}),
          "table-layout": hasColWidths() ? "fixed" : "auto",
          ...(borders().outer ? { border: `${borders().width || 1}px solid ${borders().color || "#e2e8f0"}` } : {}),
        }}
      >
        <Show when={hasColWidths()}>
          <colgroup>
            <For each={props.element.columns!}>
              {(c) => <col style={{ ...(colWidthCss(c.width) ? { width: colWidthCss(c.width) } : {}) }} />}
            </For>
          </colgroup>
        </Show>
        <Show when={headers() && headers()!.length > 0}>
          <thead>
            <tr style={headerCss()}>
              <For each={headers()!}>
                {(h, i) => (
                  <th
                    class="font-semibold"
                    classList={{ "bg-gray-50": !props.element.headerStyle }}
                    style={{
                      padding: cellPad(),
                      "text-align": props.element.columns?.[i()]?.align || "left",
                      ...(borders().inner ? { border: `${borders().width || 1}px solid ${borders().color || "#e2e8f0"}` } : {}),
                    }}
                  >
                    {edit.enabled() ? (
                      <Editable
                        value={h}
                        onCommit={(v) => commitHeader(i(), v)}
                      />
                    ) : (
                      h
                    )}
                  </th>
                )}
              </For>
            </tr>
          </thead>
        </Show>
        <tbody>
          <For each={props.element.rows}>
            {(row, rowIdx) => (
              <tr style={{ ...rowCss(), ...(rowIdx() % 2 === 1 ? altRowCss() : {}) }}>
                <For each={row}>
                  {(cell, colIdx) => (
                    <td
                      class="align-top"
                      style={{
                        padding: cellPad(),
                        "text-align": cellAlign(cell) || props.element.columns?.[colIdx()]?.align || "left",
                        ...(borders().inner ? { border: `${borders().width || 1}px solid ${borders().color || "#e2e8f0"}` } : {}),
                        ...cellCss(cell),
                      }}
                      {...cellAttrs(cell)}
                    >
                      {edit.enabled() ? (
                        <Editable
                          value={cellText(cell)}
                          onCommit={(v) => commitCell(rowIdx(), colIdx(), v)}
                        />
                      ) : (
                        // Spacer row (all cells empty) keeps one line of height, like jdf.js.
                        row.every((c) => cellText(c) === "") ? "\u00a0" : cellText(cell)
                      )}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
