-- Pandoc Lua filter for course exports.
--
-- Maps the fenced Divs the exporter emits (alert / link-card / attachment /
-- page-break) onto format-specific output: Typst calls the helpers defined in
-- template.typ; DOCX uses custom paragraph styles from reference.docx.
--
-- Labels (alert titles, attachment prefix) are single-sourced from
-- lib/config/labels.js: the exporter passes them as `labels:` metadata and the
-- Meta handler below overwrites these English fallbacks. Alert kinds mirror
-- ALERT_CONFIG in lib/convert/markdown-to-html.js. Keep those in sync.

local LABELS = {
  note = "Note",
  tip = "Tip",
  important = "Important",
  warning = "Warning",
  caution = "Caution",
  check = "Check",
  attachment = "Attachment:",
}

local ALERT_KINDS = {
  note = true, tip = true, important = true,
  warning = true, caution = true, check = true,
}

-- Escape a Lua string for inclusion inside a Typst string literal.
local function typst_str(s)
  return s:gsub("\\", "\\\\"):gsub('"', '\\"')
end

local function has_class(el, name)
  for _, c in ipairs(el.classes) do
    if c == name then return true end
  end
  return false
end

local function alert_kind(el)
  for _, c in ipairs(el.classes) do
    if ALERT_KINDS[c] then return c end
  end
  return "note"
end

-- Typst raw blocks that open/close a call around the div's content.
local function typst_open(code)
  return pandoc.RawBlock("typst", code)
end

local function render_typst_alert(el)
  local kind = alert_kind(el)
  local title = LABELS[kind] or LABELS.note
  local blocks = pandoc.List()
  blocks:insert(typst_open('#alert("' .. kind .. '", "' .. typst_str(title) .. '")['))
  blocks:extend(el.content)
  blocks:insert(typst_open("]"))
  return blocks
end

local function render_typst_linkcard(el)
  -- Expect the div to carry data-title / data-url attributes.
  local title = el.attributes["title"] or ""
  local url = el.attributes["url"] or ""
  return typst_open('#linkcard("' .. typst_str(title) .. '", "' .. typst_str(url) .. '")')
end

local function render_typst_attachment(el)
  local name = el.attributes["name"] or ""
  return typst_open('#attachment("' .. typst_str(name) .. '")')
end

-- DOCX: wrap content paragraphs in a custom style by stashing the style name.
local function styled(blocks, style)
  local out = pandoc.List()
  for _, b in ipairs(blocks) do
    if b.t == "Para" or b.t == "Plain" then
      out:insert(pandoc.Div({ b }, pandoc.Attr("", {}, { ["custom-style"] = style })))
    else
      out:insert(b)
    end
  end
  return out
end

local function render_docx_alert(el)
  local kind = alert_kind(el)
  local title = LABELS[kind] or LABELS.note
  -- Per-kind styles in reference.docx: "Alert Title Note" .. "Alert Body Check".
  local suffix = kind:sub(1, 1):upper() .. kind:sub(2)
  local blocks = pandoc.List()
  blocks:insert(pandoc.Div(
    { pandoc.Para({ pandoc.Str(title) }) },
    pandoc.Attr("", {}, { ["custom-style"] = "Alert Title " .. suffix })
  ))
  blocks:extend(styled(el.content, "Alert Body " .. suffix))
  return blocks
end

-- A paragraph that ends in a colon, or is no more than three words long,
-- introduces the block after it ("Voorbeeld:" or "Bijv." and then the code).
-- Typst keeps a sticky block together with what follows, so the intro line
-- never ends a page on its own. PDF only: Word would need keep-with-next on the
-- paragraph, which pandoc cannot set without a custom style.
local INTRODUCES = {
  CodeBlock = true, BulletList = true, OrderedList = true,
  DefinitionList = true, Div = true, Table = true,
}

local function last_str(inlines)
  local last = inlines[#inlines]
  if last == nil then return nil end
  if last.t == "Str" then return last.text end
  if last.content and last.t ~= "Link" then return last_str(last.content) end
  return nil
end

local function is_intro(para)
  local text = last_str(para.content)
  if text and text:sub(-1) == ":" then return true end
  local words = 0
  for _ in pandoc.utils.stringify(para):gmatch("%S+") do words = words + 1 end
  return words <= 3
end

local function keep_with_next(blocks)
  if not FORMAT:match("typst") then return nil end
  local out = pandoc.List()
  for i, b in ipairs(blocks) do
    local nxt = blocks[i + 1]
    if b.t == "Para" and nxt and INTRODUCES[nxt.t] and is_intro(b) then
      out:insert(typst_open("#block(sticky: true)["))
      out:insert(b)
      out:insert(typst_open("]"))
    else
      out:insert(b)
    end
  end
  return out
end

local function render_docx_linkcard(el)
  local title = el.attributes["title"] or ""
  local url = el.attributes["url"] or ""
  return {
    pandoc.Div({ pandoc.Para({ pandoc.Str(title) }) },
      pandoc.Attr("", {}, { ["custom-style"] = "Link Card Title" })),
    pandoc.Div({ pandoc.Para({ pandoc.Link({ pandoc.Str(url) }, url) }) },
      pandoc.Attr("", {}, { ["custom-style"] = "Link Card" })),
  }
end

local function render_docx_attachment(el)
  local name = el.attributes["name"] or ""
  return pandoc.Div(
    { pandoc.Para({ pandoc.Strong({ pandoc.Str(LABELS.attachment) }), pandoc.Space(), pandoc.Str(name) }) },
    pandoc.Attr("", {}, { ["custom-style"] = "Attachment" })
  )
end

local function div(el)
  local is_typst = FORMAT:match("typst")
  local is_docx = FORMAT:match("docx")

  if has_class(el, "alert") then
    if is_typst then return render_typst_alert(el) end
    if is_docx then return render_docx_alert(el) end
  elseif has_class(el, "link-card") then
    if is_typst then return render_typst_linkcard(el) end
    if is_docx then return render_docx_linkcard(el) end
  elseif has_class(el, "attachment") then
    if is_typst then return render_typst_attachment(el) end
    if is_docx then return render_docx_attachment(el) end
  elseif has_class(el, "page-break") then
    if is_typst then return typst_open("#pagebreak(weak: true)") end
    if is_docx then
      return pandoc.RawBlock("openxml", '<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    end
  end

  return nil
end

-- Overwrite the label fallbacks from the document's `labels:` metadata.
local function capture_labels(meta)
  if meta.labels then
    for key, value in pairs(meta.labels) do
      if LABELS[key] ~= nil then
        LABELS[key] = pandoc.utils.stringify(value)
      end
    end
  end
end

-- Three sequential filter tables: within a single table pandoc runs Meta
-- *after* the block filters, so the labels must be captured in a pass of their
-- own before any Div is rendered; and keep_with_next has to see an alert while
-- it is still a Div, before the third pass turns it into raw Typst.
return {
  { Meta = capture_labels },
  { Blocks = keep_with_next },
  { Div = div },
}
