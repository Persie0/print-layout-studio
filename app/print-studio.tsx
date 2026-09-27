"use client";
/* eslint-disable @next/next/no-img-element -- IndexedDB blob URLs are local-only images. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ClipboardEvent } from "react";
import {
  FileText,
  ImagePlus,
  Layers2,
  Download,
  Minus,
  Plus,
  Printer,
  RotateCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { readImageDimensions } from "@/lib/image-dimensions";
import { createId } from "@/lib/ids";
import { layoutPage } from "@/lib/layout";
import { estimateTextHeightRatio, getTextMatchScaleFactors } from "@/lib/text-matching";
import { createPageArchive, readPageArchive } from "@/lib/page-archive";
import { getPageSize, getPrintPageName, PAPER_FORMATS } from "@/lib/paper-formats";
import { loadWorkspace, removeStoredImage, saveWorkspace } from "@/lib/storage";
import type { StoredImage, StoredText, Workspace } from "@/lib/storage";
import type { PaperFormat } from "@/lib/paper-formats";

const EMPTY_WORKSPACE: Workspace = {
  paper: "a4",
  orientation: "portrait",
  marginMm: 4,
  borderMm: 1,
  gapMm: 2,
  pageCount: 1,
  images: [],
  texts: [],
};

const PT_PER_MM = 72 / 25.4;
const MAX_PAGES = 30;
const TEXT_WIDTH_PT = 240;
const TEXT_PADDING_PT = 8;

type PageMetrics = {
  width: number;
  height: number;
  margin: number;
  innerWidth: number;
  innerHeight: number;
  layout: ReturnType<typeof layoutPage>;
};

type PageItem = (StoredImage & { type: "image"; scaleFactor?: number }) | (StoredText & { type: "text"; width: number; height: number });

function estimateTextHeight(text: string, fontSize: number, width: number) {
  const usableWidth = Math.max(20, width - TEXT_PADDING_PT * 2);
  const maxCharacters = Math.max(1, Math.floor(usableWidth / (fontSize * 0.57)));
  let lineCount = 0;
  for (const paragraph of (text || " ").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lineCount += 1;
      continue;
    }
    let lineLength = 0;
    for (const word of words) {
      const chunks = word.match(new RegExp(`.{1,${maxCharacters}}`, "g")) ?? [word];
      for (const chunk of chunks) {
        const extra = lineLength === 0 ? chunk.length : chunk.length + 1;
        if (lineLength > 0 && lineLength + extra > maxCharacters) {
          lineCount += 1;
          lineLength = chunk.length;
        } else {
          lineLength += extra;
        }
      }
    }
    lineCount += 1;
  }
  return Math.max(fontSize * 1.4, lineCount * fontSize * 1.45) + TEXT_PADDING_PT * 2;
}

function calculatePage(workspace: Workspace, pageNumber: number, imageScaleFactors: Map<string, number>): PageMetrics {
  const { width, height } = getPageSize(workspace.paper, workspace.orientation);
  const margin = Math.max(0, workspace.marginMm) * PT_PER_MM;
  const innerWidth = Math.max(1, width - margin * 2);
  const innerHeight = Math.max(1, height - margin * 2);
  const images: PageItem[] = workspace.images
    .filter((image) => image.page === pageNumber)
    .map((image) => ({ ...image, type: "image", scaleFactor: imageScaleFactors.get(image.id) ?? 1 }));
  const texts: PageItem[] = workspace.texts
    .filter((text) => text.page === pageNumber)
    .map((text) => {
      const textWidth = Math.min(TEXT_WIDTH_PT, innerWidth);
      return {
        ...text,
        type: "text",
        width: textWidth,
        height: estimateTextHeight(text.content, text.fontSize, textWidth),
      };
    });
  const items = [...images, ...texts];
  const layout = layoutPage({
    width: innerWidth,
    height: innerHeight,
    gap: Math.max(0, workspace.gapMm) * PT_PER_MM,
    imageBorder: Math.max(0, workspace.borderMm) * PT_PER_MM,
    items: items.map((item) => ({
      id: item.id,
      type: item.type,
      width: item.width,
      height: item.height,
      ...(item.type === "image" ? { scaleFactor: item.scaleFactor } : {}),
    })),
  });
  return { width, height, margin, innerWidth, innerHeight, layout };
}

function clampPageCount(value: number) {
  return Math.max(1, Math.min(MAX_PAGES, Math.round(value) || 1));
}

function PageImage({ image, src }: { image: StoredImage; src?: string }) {
  return src ? <img src={src} alt={image.name} draggable={false} /> : null;
}

function PageSheet({
  workspace,
  imageUrls,
  pageNumber,
  metrics,
  selectedItemId,
  onSelect,
  print = false,
}: {
  workspace: Workspace;
  imageUrls: Map<string, string>;
  pageNumber: number;
  metrics: PageMetrics;
  selectedItemId?: string | null;
  onSelect?: (id: string) => void;
  print?: boolean;
}) {
  const images = new Map(workspace.images.map((image) => [image.id, image]));
  const texts = new Map(workspace.texts.map((text) => [text.id, text]));
  const sheetStyle = {
    aspectRatio: `${metrics.width} / ${metrics.height}`,
    ...(print ? { width: `${metrics.width}pt`, height: `${metrics.height}pt` } : {}),
    "--paper-width-pt": metrics.width,
  } as CSSProperties;

  return (
    <div
      className={`paper-sheet${print ? " print-sheet" : ""}`}
      style={sheetStyle}
      data-page-number={pageNumber}
      aria-label={`Page ${pageNumber}`}
    >
      {!metrics.layout.fits ? (
        <div className="sheet-warning">
          <strong>Some text does not fit on this page.</strong>
          <span>Shorten a text block or reduce its type size.</span>
        </div>
      ) : null}
      {metrics.layout.placements.map((placement) => {
        const left = `${((metrics.margin + placement.x) / metrics.width) * 100}%`;
        const top = `${((metrics.margin + placement.y) / metrics.height) * 100}%`;
        const width = `${(placement.width / metrics.width) * 100}%`;
        const height = `${(placement.height / metrics.height) * 100}%`;
          const position: CSSProperties = {
            left,
            top,
            width,
            height,
            "--image-border-width": `${workspace.borderMm}mm`,
          } as CSSProperties;
        const selected = selectedItemId === placement.id && !print;

        if (placement.type === "image") {
          const image = images.get(placement.id);
          if (!image) return null;
          const className = `sheet-image${selected ? " is-selected" : ""}`;
          return onSelect ? (
            <button
              type="button"
              className={className}
              style={position}
              key={placement.id}
              onClick={() => onSelect(placement.id)}
              aria-label={`Select image ${image.name}`}
            >
              <PageImage image={image} src={imageUrls.get(image.id)} />
            </button>
          ) : (
            <div className="sheet-image" style={position} key={placement.id}>
              <PageImage image={image} src={imageUrls.get(image.id)} />
            </div>
          );
        }

        const text = texts.get(placement.id);
        if (!text) return null;
        const typeSize = `${(text.fontSize * 100) / metrics.width}cqw`;
        const padding = `${(TEXT_PADDING_PT * 100) / metrics.width}cqw`;
        const textStyle = { ...position, fontSize: typeSize, padding } as CSSProperties;
        const className = `sheet-text${selected ? " is-selected" : ""}`;
        return onSelect ? (
          <button
            type="button"
            className={className}
            style={textStyle}
            key={placement.id}
            onClick={() => onSelect(placement.id)}
            aria-label={`Select text block: ${text.content.slice(0, 60)}`}
          >
            {text.content}
          </button>
        ) : (
          <div className="sheet-text" style={textStyle} key={placement.id}>
            {text.content}
          </div>
        );
      })}
      {!print && metrics.layout.fits && metrics.layout.placements.length === 0 ? (
        <div className="sheet-empty">
          <Layers2 size={20} aria-hidden="true" />
          <span>Add images or a text block to this page</span>
        </div>
      ) : null}
    </div>
  );
}

function SaveIndicator({ state }: { state: "loading" | "saving" | "saved" | "error" }) {
  const labels = {
    loading: "Opening this device’s draft…",
    saving: "Saving on this device…",
    saved: "Saved on this device",
    error: "Could not save this draft",
  };
  return <div className={`save-indicator save-${state}`} aria-live="polite">{labels[state]}</div>;
}

export default function PrintStudio() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [activePage, setActivePage] = useState(1);
  const [targetPage, setTargetPage] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftFontSize, setDraftFontSize] = useState(16);
  const [dragging, setDragging] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [saveState, setSaveState] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [ready, setReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const imageUrlsRef = useRef<Map<string, string>>(new Map());
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => () => {
    for (const url of imageUrlsRef.current.values()) URL.revokeObjectURL(url);
    imageUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadWorkspace()
      .then((stored) => {
        if (cancelled) return;
        const restored = stored ?? EMPTY_WORKSPACE;
        const urls = new Map(restored.images.map((image) => [image.id, URL.createObjectURL(image.blob)]));
        imageUrlsRef.current = urls;
        setImageUrls(urls);
        setWorkspace(restored);
        setActivePage(1);
        setTargetPage(1);
        setSaveState("saved");
      })
      .catch(() => {
        if (!cancelled) setSaveState("error");
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
          setSaveState((current) => current === "error" ? "error" : "saved");
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      saveWorkspace(workspace)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [ready, workspace]);

  const imageScaleFactors = useMemo(() => getTextMatchScaleFactors(workspace.images), [workspace.images]);
  const activeMetrics = useMemo(
    () => calculatePage(workspace, activePage, imageScaleFactors),
    [workspace, activePage, imageScaleFactors],
  );
  const activeImages = workspace.images.filter((image) => image.page === activePage);
  const activeTexts = workspace.texts.filter((text) => text.page === activePage);
  const selectedText = workspace.texts.find((text) => text.id === selectedItemId) ?? null;

  const updatePageCount = useCallback((rawValue: number) => {
    const count = clampPageCount(rawValue);
    setWorkspace((current) => ({
      ...current,
      pageCount: count,
      images: current.images.map((image) => image.page > count ? { ...image, page: count } : image),
      texts: current.texts.map((text) => text.page > count ? { ...text, page: count } : text),
    }));
    setActivePage((current) => Math.min(current, count));
    setTargetPage((current) => Math.min(current, count));
  }, []);

  const addFiles = useCallback(async (files: FileList | File[], assignedPages?: number[]) => {
    const candidates = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (candidates.length === 0) {
      setErrorMessage("Choose or paste image files to add them to a page.");
      return;
    }
    setErrorMessage("");
    setSaveState("saving");
    const newImages: StoredImage[] = [];
    for (const [index, file] of candidates.entries()) {
      try {
        const { width, height } = await readImageDimensions(file);
        newImages.push({
          id: createId(),
          name: file.name || `Pasted image ${newImages.length + 1}`,
          page: assignedPages?.[index] ?? targetPage,
          width,
          height,
          blob: file,
        });
      } catch (error) {
        const reason = error instanceof Error ? ` ${error.message}` : "";
        console.error("Could not decode image", file.name, error);
        setErrorMessage(`Could not read ${file.name || "one pasted image"}.${reason}`);
      }
    }
    if (newImages.length > 0) {
      const urls = new Map(imageUrlsRef.current);
      for (const image of newImages) urls.set(image.id, URL.createObjectURL(image.blob));
      imageUrlsRef.current = urls;
      setImageUrls(urls);
      const assignedPage = newImages[0].page;
      const importedPageCount = Math.max(...newImages.map((image) => image.page));
      setWorkspace((current) => ({
        ...current,
        pageCount: Math.max(current.pageCount, clampPageCount(importedPageCount)),
        images: [...current.images, ...newImages],
      }));
      setActivePage(assignedPage);
      setTargetPage(assignedPage);
      setSelectedItemId(null);
    }
  }, [targetPage]);

  const importPageZip = useCallback(async (file: File) => {
    try {
      const imported = readPageArchive(new Uint8Array(await file.arrayBuffer()));
      await addFiles(imported.images.map((image) => image.file), imported.images.map((image) => image.page));
      setWorkspace((current) => ({ ...current, pageCount: Math.max(current.pageCount, imported.pageCount) }));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not read this ZIP file.");
    }
  }, [addFiles]);

  const downloadPageZip = useCallback(async () => {
    if (workspace.images.length === 0) {
      setErrorMessage("Add images before downloading a page ZIP.");
      return;
    }
    try {
      const archive = await createPageArchive(workspace.images, workspace.pageCount);
      const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([archiveBuffer], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "print-layout-pages.zip";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create the page ZIP.");
    }
  }, [workspace.images, workspace.pageCount]);

  const matchTextSizes = useCallback(async () => {
    if (workspace.images.length === 0 || ocrRunning) return;
    setOcrRunning(true);
    setOcrProgress("Loading English OCR…");
    setErrorMessage("");
    let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | undefined;
    try {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("eng", 1, {
        logger: (message) => {
          if (message.status === "loading language traineddata") setOcrProgress("Loading English OCR…");
        },
      });
      const ratios = new Map<string, number | null>();
      for (const [index, image] of workspace.images.entries()) {
        setOcrProgress(`Reading image ${index + 1} of ${workspace.images.length}…`);
        const bitmap = await createImageBitmap(image.blob);
        try {
          const shrink = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * shrink));
          canvas.height = Math.max(1, Math.round(bitmap.height * shrink));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not prepare an image for text detection.");
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const { data } = await worker.recognize(canvas, {}, { blocks: true });
          const words = data.blocks?.flatMap((block) =>
            block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)),
          ) ?? [];
          ratios.set(image.id, estimateTextHeightRatio(words, canvas.height));
        } finally {
          bitmap.close();
        }
      }
      setWorkspace((current) => ({
        ...current,
        images: current.images.map((image) => {
          const ratio = ratios.get(image.id);
          return ratio ? { ...image, textHeightRatio: ratio } : image;
        }),
      }));
      const recognizedCount = [...ratios.values()].filter(Boolean).length;
      setErrorMessage(recognizedCount > 0
        ? `Matched text size in ${recognizedCount} of ${ratios.size} images.`
        : "No readable text found. Images keep their current sizes.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? `Text detection failed: ${error.message}` : "Text detection failed.");
    } finally {
      await worker?.terminate().catch(() => undefined);
      setOcrRunning(false);
      setOcrProgress("");
    }
  }, [ocrRunning, workspace.images]);

  const onPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  }, [addFiles]);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  }, [addFiles]);

  const assignItem = useCallback((id: string, page: number) => {
    setWorkspace((current) => ({
      ...current,
      images: current.images.map((image) => image.id === id ? { ...image, page } : image),
      texts: current.texts.map((text) => text.id === id ? { ...text, page } : text),
    }));
    if (selectedItemId === id && page !== activePage) setSelectedItemId(null);
  }, [activePage, selectedItemId]);

  const deleteItem = useCallback((id: string) => {
    const urls = new Map(imageUrlsRef.current);
    const removedUrl = urls.get(id);
    if (removedUrl) URL.revokeObjectURL(removedUrl);
    urls.delete(id);
    imageUrlsRef.current = urls;
    setImageUrls(urls);
    setWorkspace((current) => ({
      ...current,
      images: current.images.filter((image) => image.id !== id),
      texts: current.texts.filter((text) => text.id !== id),
    }));
    void removeStoredImage(id).catch(() => undefined);
    if (selectedItemId === id) setSelectedItemId(null);
  }, [selectedItemId]);

  const saveText = useCallback(() => {
    const content = draftText.trim();
    if (!content) {
      setErrorMessage("Write something before adding a text block.");
      return;
    }
    const fontSize = Math.max(8, Math.min(72, Number(draftFontSize) || 16));
    setErrorMessage("");
    if (selectedText) {
      setWorkspace((current) => ({
        ...current,
        texts: current.texts.map((text) => text.id === selectedText.id
          ? { ...text, content, fontSize }
          : text),
      }));
    } else {
      const text: StoredText = { id: createId(), page: targetPage, content, fontSize };
      setWorkspace((current) => ({ ...current, texts: [...current.texts, text] }));
      setActivePage(targetPage);
      setSelectedItemId(text.id);
    }
  }, [draftFontSize, draftText, selectedText, targetPage]);

  const startNewText = useCallback(() => {
    setSelectedItemId(null);
    setDraftText("");
    setDraftFontSize(16);
  }, []);

  const onImageItemClick = useCallback((image: StoredImage) => {
    setSelectedItemId(image.id);
    setTargetPage(image.page);
  }, []);

  const pageOptions = Array.from({ length: workspace.pageCount }, (_, index) => index + 1);
  const allPageMetrics = useMemo(
    () => pageOptions.map((pageNumber) => calculatePage(workspace, pageNumber, imageScaleFactors)),
    // page count determines the print pages; the workspace snapshot drives their content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspace, imageScaleFactors],
  );
  const currentPaper = PAPER_FORMATS[workspace.paper];

  return (
    <div className="app-shell" onPaste={onPaste}>
      <style>{`@media print { @page { size: ${getPrintPageName(workspace.paper)} ${workspace.orientation}; margin: 0; } }`}</style>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Layers2 size={20} strokeWidth={2.5} /></span>
          <div>
            <p className="brand-name">Sheetline</p>
            <p className="brand-caption">PRINT LAYOUT STUDIO</p>
          </div>
        </div>
        <div className="topbar-actions">
          <SaveIndicator state={saveState} />
          <Button className="print-button" onClick={() => window.print()}>
            <Printer size={17} aria-hidden="true" />
            Print pages
          </Button>
        </div>
      </header>

      <section className="paper-toolbar" aria-label="Page setup">
        <div className="toolbar-field paper-field">
          <label>Paper format</label>
          <Select
            value={workspace.paper}
            onValueChange={(value) => {
              if (value in PAPER_FORMATS) {
                setWorkspace((current) => ({ ...current, paper: value as PaperFormat }));
              }
            }}
          >
            <SelectTrigger className="toolbar-select" aria-label="Paper format"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="a3">A3</SelectItem>
              <SelectItem value="a4">A4</SelectItem>
              <SelectItem value="a5">A5</SelectItem>
              <SelectItem value="letter">US Letter</SelectItem>
              <SelectItem value="legal">US Legal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="toolbar-field orientation-field">
          <label>Orientation</label>
          <Button
            variant="outline"
            className="orientation-button"
            onClick={() => setWorkspace((current) => ({
              ...current,
              orientation: current.orientation === "portrait" ? "landscape" : "portrait",
            }))}
            aria-label={`Switch to ${workspace.orientation === "portrait" ? "landscape" : "portrait"}`}
          >
            <RotateCw size={15} aria-hidden="true" />
            {workspace.orientation === "portrait" ? "Portrait" : "Landscape"}
          </Button>
        </div>
        <div className="toolbar-field page-count-field">
          <label htmlFor="page-count">Pages</label>
          <div className="number-stepper">
            <Button variant="outline" size="icon-sm" aria-label="Remove one page" onClick={() => updatePageCount(workspace.pageCount - 1)} disabled={workspace.pageCount <= 1}>
              <Minus size={15} />
            </Button>
            <Input
              id="page-count"
              className="page-count-input"
              type="number"
              min={1}
              max={MAX_PAGES}
              value={workspace.pageCount}
              onChange={(event) => updatePageCount(Number(event.target.value))}
              aria-label="Number of pages"
            />
            <Button variant="outline" size="icon-sm" aria-label="Add one page" onClick={() => updatePageCount(workspace.pageCount + 1)} disabled={workspace.pageCount >= MAX_PAGES}>
              <Plus size={15} />
            </Button>
          </div>
        </div>
        <div className="toolbar-field margin-field">
          <label htmlFor="print-margin">Printer margin</label>
          <div className="margin-input-wrap">
            <Input
              id="print-margin"
              className="margin-input"
              type="number"
              min={2}
              max={20}
              step={1}
              value={workspace.marginMm}
              onChange={(event) => setWorkspace((current) => ({
                ...current,
                marginMm: Math.max(2, Math.min(20, Number(event.target.value) || 2)),
              }))}
              aria-label="Printer margin in millimeters"
            />
            <span>mm</span>
          </div>
        </div>
        <div className="toolbar-field border-field">
          <label htmlFor="border-width">Image border</label>
          <div className="margin-input-wrap">
            <Input
              id="border-width"
              className="margin-input"
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={workspace.borderMm}
              onChange={(event) => setWorkspace((current) => ({
                ...current,
                borderMm: Math.max(0, Math.min(10, Number(event.target.value) || 0)),
              }))}
              aria-label="Image border width in millimeters"
            />
            <span>mm</span>
          </div>
        </div>
        <div className="toolbar-field gap-field">
          <label htmlFor="image-gap">Image gap</label>
          <div className="margin-input-wrap">
            <Input
              id="image-gap"
              className="margin-input"
              type="number"
              min={0}
              max={20}
              step={0.5}
              value={workspace.gapMm}
              onChange={(event) => setWorkspace((current) => ({
                ...current,
                gapMm: Math.max(0, Math.min(20, Number(event.target.value) || 0)),
              }))}
              aria-label="Gap between images in millimeters"
            />
            <span>mm</span>
          </div>
        </div>
        <p className="toolbar-hint">A small safe edge for most home printers</p>
      </section>

      <main className="studio-layout">
        <aside className="inspector" aria-label="Page contents">
          <section className="inspector-section">
            <div className="section-heading">
              <div className="section-title"><span className="section-number">01</span><h2>Add images</h2></div>
              <Button variant="ghost" size="icon-sm" aria-label="Choose image files" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus size={17} />
              </Button>
            </div>
            <div
              className={`dropzone${dragging ? " is-dragging" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="upload-icon"><Upload size={18} /></span>
              <p><strong>Drop images here</strong> or <button type="button" onClick={() => fileInputRef.current?.click()}>browse files</button></p>
              <span>Paste images with Ctrl+V or ⌘V</span>
              <Input
                ref={fileInputRef}
                className="file-input"
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  if (event.currentTarget.files) void addFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
                aria-label="Choose images"
              />
              <div className="archive-actions">
                <Button variant="outline" size="sm" onClick={() => void matchTextSizes()} disabled={workspace.images.length === 0 || ocrRunning}>
                  {ocrRunning ? ocrProgress : "Match text size"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => archiveInputRef.current?.click()}>
                  Import page ZIP
                </Button>
                <Input
                  ref={archiveInputRef}
                  className="file-input"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void importPageZip(file);
                    event.currentTarget.value = "";
                  }}
                  aria-label="Import page ZIP"
                />
              </div>
            </div>
            <div className="target-page-control">
              <label htmlFor="image-target">Place new items on</label>
              <Select value={String(targetPage)} onValueChange={(value) => setTargetPage(Number(value))}>
                <SelectTrigger id="image-target" className="target-select" aria-label="Page for new items"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {pageOptions.map((page) => <SelectItem key={page} value={String(page)}>Page {page}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="storage-note">Your images stay in this browser on this device.</p>
            <p className="storage-note">Text matching downloads English OCR once, then analyzes images locally.</p>
          </section>

          <section className="inspector-section text-editor-section">
            <div className="section-heading">
              <div className="section-title"><span className="section-number">02</span><h2>Text block</h2></div>
              {selectedText ? (
                <Button variant="ghost" size="sm" onClick={startNewText}>New</Button>
              ) : <FileText className="section-icon" size={18} aria-hidden="true" />}
            </div>
            <Textarea
              className="text-entry"
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              placeholder="Write a caption or note…"
              aria-label="Text block content"
            />
            <div className="text-controls">
              <label htmlFor="text-size">Type size</label>
              <div className="margin-input-wrap">
                <Input
                  id="text-size"
                  className="text-size-input"
                  type="number"
                  min={8}
                  max={72}
                  value={draftFontSize}
                  onChange={(event) => setDraftFontSize(Math.max(8, Math.min(72, Number(event.target.value) || 8)))}
                />
                <span>pt</span>
              </div>
              <Button className="text-save-button" onClick={saveText}>
                <Plus size={15} aria-hidden="true" />
                {selectedText ? "Save text" : "Add text block"}
              </Button>
            </div>
            <p className="storage-note">Each text block stays together when the page is arranged.</p>
          </section>

          <section className="inspector-section contents-section">
            <div className="section-heading contents-heading">
              <div className="section-title"><span className="section-number">03</span><h2>Page {activePage} items</h2></div>
              <div className="contents-actions">
                <span className="item-count">{activeImages.length + activeTexts.length}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void downloadPageZip()}
                  disabled={workspace.images.length === 0}
                  aria-label="Download pages as ZIP"
                  title="Download images in page folders"
                >
                  <Download size={15} />
                </Button>
              </div>
            </div>
            {activeImages.length + activeTexts.length === 0 ? (
              <div className="empty-list">Items added to this page will appear here.</div>
            ) : (
              <div className="item-list">
                {activeImages.map((image) => (
                  <div className={`item-row${selectedItemId === image.id ? " item-selected" : ""}`} key={image.id}>
                    <button className="item-main" type="button" onClick={() => onImageItemClick(image)} aria-label={`Select ${image.name}`}>
                      <span className="item-thumb"><PageImage image={image} src={imageUrls.get(image.id)} /></span>
                      <span className="item-name">{image.name}</span>
                    </button>
                    <Select value={String(image.page)} onValueChange={(value) => assignItem(image.id, Number(value))}>
                      <SelectTrigger className="item-page-select" aria-label={`Page for ${image.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{pageOptions.map((page) => <SelectItem key={page} value={String(page)}>Page {page}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon-xs" className="delete-item" aria-label={`Remove ${image.name}`} onClick={() => deleteItem(image.id)}><Trash2 size={14} /></Button>
                  </div>
                ))}
                {activeTexts.map((text) => (
                  <div className={`item-row${selectedItemId === text.id ? " item-selected" : ""}`} key={text.id}>
                    <button className="item-main" type="button" onClick={() => {
                      setSelectedItemId(text.id);
                      setTargetPage(text.page);
                      setDraftText(text.content);
                      setDraftFontSize(text.fontSize);
                    }} aria-label={`Edit text block: ${text.content.slice(0, 40)}`}>
                      <span className="item-text-icon"><FileText size={17} /></span>
                      <span className="item-name">{text.content || "Text block"}</span>
                    </button>
                    <Select value={String(text.page)} onValueChange={(value) => assignItem(text.id, Number(value))}>
                      <SelectTrigger className="item-page-select" aria-label="Page for text block"><SelectValue /></SelectTrigger>
                      <SelectContent>{pageOptions.map((page) => <SelectItem key={page} value={String(page)}>Page {page}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon-xs" className="delete-item" aria-label="Remove text block" onClick={() => deleteItem(text.id)}><Trash2 size={14} /></Button>
                  </div>
                ))}
              </div>
            )}
          </section>
          {errorMessage ? (
            <p className={`error-message${errorMessage.startsWith("Matched text size") ? " success-message" : ""}`} role="alert">
              {errorMessage}
            </p>
          ) : null}
        </aside>

        <section className="preview-panel" aria-label="Page preview">
          <div className="preview-topline">
            <div>
              <p className="eyebrow">PRINT PREVIEW</p>
              <h1>Arrange your pages</h1>
            </div>
            <div className="preview-spec">{currentPaper.label} · {workspace.orientation} · {workspace.marginMm} mm edge · {workspace.borderMm} mm border · {workspace.gapMm} mm gap</div>
          </div>
          <Tabs value={String(activePage)} onValueChange={(value) => {
            const page = Number(value);
            setActivePage(page);
            setTargetPage(page);
            setSelectedItemId(null);
          }} className="page-tabs-root">
            <TabsList variant="line" className="page-tabs">
              {pageOptions.map((page) => <TabsTrigger key={page} value={String(page)}>Page {page}</TabsTrigger>)}
            </TabsList>
            <TabsContent value={String(activePage)} className="page-tab-content">
              <div className="paper-stage">
                <PageSheet
                  workspace={workspace}
                  imageUrls={imageUrls}
                  pageNumber={activePage}
                  metrics={activeMetrics}
                  selectedItemId={selectedItemId}
                  onSelect={setSelectedItemId}
                />
              </div>
              <div className="preview-footer">
                <span>Images keep their proportions · text prints at its chosen size</span>
                {activeMetrics.layout.fits ? <span>{activeMetrics.layout.placements.length} placed</span> : <span className="warning-label">Check text size</span>}
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </main>

      <div className="print-document" aria-hidden="true">
        {pageOptions.map((page, index) => (
          <PageSheet
            key={`print-${page}`}
            workspace={workspace}
            imageUrls={imageUrls}
            pageNumber={page}
            metrics={allPageMetrics[index]}
            print
          />
        ))}
      </div>
    </div>
  );
}
