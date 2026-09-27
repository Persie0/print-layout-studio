"use client";
/* eslint-disable @next/next/no-img-element -- IndexedDB blob URLs are local-only images. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ClipboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { readImageDimensions } from "@/lib/image-dimensions";
import { createId } from "@/lib/ids";
import { createImageGroup, MAX_IMAGE_GROUPS } from "@/lib/image-groups";
import { choosePageLayout } from "@/lib/page-orientation";
import { estimateAveragePrintedTextHeightMm, estimatePrintedTextHeightMm, estimateTextHeightRatio, getOcrStatusLabel, getTextMatchScaleFactors, getUnscannedImages } from "@/lib/text-matching";
import { renderLatexToString } from "@/lib/latex-rendering";
import { renderMarkdownToString, splitTextBlocks } from "@/lib/markdown-rendering";
import { fitPageIntoFrame } from "@/lib/preview-fit";
import { createPageArchive, readPageArchive } from "@/lib/page-archive";
import { getPageSize, getPrintPageName, PAPER_FORMATS } from "@/lib/paper-formats";
import { loadWorkspace, removeStoredImage, saveWorkspace } from "@/lib/storage";
import type { StoredImage, StoredText, Workspace } from "@/lib/storage";
import type { PaperFormat } from "@/lib/paper-formats";

const EMPTY_WORKSPACE: Workspace = {
  paper: "a4",
  orientation: "auto",
  marginMm: 4,
  borderMm: 1,
  gapMm: 2,
  pageCount: 1,
  autoOcrOnPaste: false,
  autoMatchTextSize: true,
  groups: [],
  images: [],
  texts: [],
};

const PT_PER_MM = 72 / 25.4;
const MAX_PAGES = 30;
const TEXT_WIDTH_PT = 240;
const TEXT_PADDING_PT = 8;

type PageMetrics = {
  orientation: "portrait" | "landscape";
  width: number;
  height: number;
  margin: number;
  innerWidth: number;
  innerHeight: number;
  layout: ReturnType<typeof choosePageLayout>["layout"];
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

function estimateMathBlockHeight(text: string, fontSize: number) {
  const rows = Math.max(1, text.split(/\\\\|\n/).length);
  return Math.max(fontSize * 1.7, rows * fontSize * 1.7) + TEXT_PADDING_PT * 2;
}

function printedTextSizeLabel(image: StoredImage, placement: PageMetrics["layout"]["placements"][number] | undefined, borderMm: number) {
  if (!(Number(image.textHeightRatio) > 0)) {
    return image.ocrScanned ? "No text found" : "Text size not scanned";
  }
  const heightMm = estimatePrintedTextHeightMm(image, placement, borderMm);
  if (heightMm === null) return "Text size unavailable";
  return `Printed text ≈ ${heightMm < 0.05 ? "<0.1" : heightMm.toFixed(1)} mm`;
}

function calculatePage(workspace: Workspace, pageNumber: number, imageScaleFactors: Map<string, number>): PageMetrics {
  const margin = Math.max(0, workspace.marginMm) * PT_PER_MM;
  const portraitSize = getPageSize(workspace.paper, "portrait");
  const landscapeSize = getPageSize(workspace.paper, "landscape");
  const images: PageItem[] = workspace.images
    .filter((image) => image.page === pageNumber)
    .map((image) => ({ ...image, type: "image", scaleFactor: imageScaleFactors.get(image.id) ?? 1 }));
  const texts: PageItem[] = workspace.texts
    .filter((text) => text.page === pageNumber)
    .map((text) => {
      const textWidth = Math.min(TEXT_WIDTH_PT, Math.max(1, portraitSize.width - margin * 2));
      return {
        ...text,
        type: "text",
        width: textWidth,
        height: text.format === "latex"
          ? estimateMathBlockHeight(text.content, text.fontSize)
          : estimateTextHeight(text.content, text.fontSize, textWidth),
      };
    });
  const items = [...images, ...texts];
  const choice = choosePageLayout({
    portraitSize,
    landscapeSize,
    orientation: workspace.orientation,
    margin,
    gap: Math.max(0, workspace.gapMm) * PT_PER_MM,
    imageBorder: Math.max(0, workspace.borderMm) * PT_PER_MM,
    items: items.map((item) => ({
      id: item.id,
      type: item.type,
      width: item.width,
      height: item.height,
      ...(item.type === "image" ? {
        scaleFactor: item.scaleFactor,
        textHeightRatio: item.textHeightRatio,
      } : {}),
    })),
  });
  return { ...choice, margin };
}

function clampPageCount(value: number) {
  return Math.max(1, Math.min(MAX_PAGES, Math.round(value) || 1));
}

function PageImage({ image, src }: { image: StoredImage; src?: string }) {
  return src ? <img src={src} alt={image.name} draggable={false} /> : null;
}

function TextBlockContent({ text }: { text: StoredText }) {
  if (text.format === "latex") {
    return <span className="math-content" dangerouslySetInnerHTML={{ __html: renderLatexToString(text.content) }} />;
  }
  if (text.format === "markdown") {
    return <span className="markdown-content" dangerouslySetInnerHTML={{ __html: renderMarkdownToString(text.content) }} />;
  }
  return text.content;
}

function PageSheet({
  workspace,
  imageUrls,
  pageNumber,
  metrics,
  selectedItemId,
  onSelect,
  previewSize,
  print = false,
}: {
  workspace: Workspace;
  imageUrls: Map<string, string>;
  pageNumber: number;
  metrics: PageMetrics;
  selectedItemId?: string | null;
  onSelect?: (id: string) => void;
  previewSize?: { width: number; height: number };
  print?: boolean;
}) {
  const images = new Map(workspace.images.map((image) => [image.id, image]));
  const texts = new Map(workspace.texts.map((text) => [text.id, text]));
  const groups = new Map(workspace.groups.map((group) => [group.id, group]));
  const sheetStyle = {
    aspectRatio: `${metrics.width} / ${metrics.height}`,
    ...(print ? {
      width: `${metrics.width}pt`,
      height: `${metrics.height}pt`,
      page: metrics.orientation === "landscape" ? "sheetLandscape" : "sheetPortrait",
    } : previewSize ? {
      width: `${previewSize.width}px`,
      height: `${previewSize.height}px`,
    } : {}),
    "--paper-width-pt": metrics.width,
  } as CSSProperties & { "--paper-width-pt": number };

  return (
    <div
      className={`paper-sheet${print ? " print-sheet" : ""}`}
      style={sheetStyle}
      data-page-number={pageNumber}
      data-orientation={metrics.orientation}
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
          const group = image.groupId ? groups.get(image.groupId) : undefined;
          const imageStyle = {
            ...position,
            "--image-border-color": group?.color ?? "#53656a",
          } as CSSProperties;
          const className = `sheet-image${selected ? " is-selected" : ""}`;
          const imageContent = <PageImage image={image} src={imageUrls.get(image.id)} />;
          return onSelect ? (
            <button
              type="button"
              className={className}
              style={imageStyle}
              key={placement.id}
              onClick={() => onSelect(placement.id)}
              aria-label={`Select image ${image.name}`}
            >
              {imageContent}
            </button>
          ) : (
            <div className="sheet-image" style={imageStyle} key={placement.id} data-sheet-item>
              {imageContent}
            </div>
          );
        }

        const text = texts.get(placement.id);
        if (!text) return null;
        const typeSize = `${(text.fontSize * 100) / metrics.width}cqw`;
        const padding = `${(TEXT_PADDING_PT * 100) / metrics.width}cqw`;
        const textStyle = { ...position, fontSize: typeSize, padding } as CSSProperties;
        const className = `sheet-text${text.format === "latex" ? " sheet-text-latex" : ""}${text.format === "markdown" ? " sheet-text-markdown" : ""}${selected ? " is-selected" : ""}`;
        return onSelect ? (
          <button
            type="button"
            className={className}
            style={textStyle}
            key={placement.id}
            onClick={() => onSelect(placement.id)}
            aria-label={`Select text block: ${text.content.slice(0, 60)}`}
          >
            <TextBlockContent text={text} />
          </button>
        ) : (
          <div className={className} style={textStyle} key={placement.id}>
            <TextBlockContent text={text} />
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
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftFontSize, setDraftFontSize] = useState(16);
  const [draftTextFormat, setDraftTextFormat] = useState<"plain" | "latex" | "markdown">("plain");
  const [splitTextOnBlankLines, setSplitTextOnBlankLines] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState("");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 });
  const [previewPanning, setPreviewPanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveState, setSaveState] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [ready, setReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const imageUrlsRef = useRef<Map<string, string>>(new Map());
  const previewStageRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const ocrQueueRef = useRef<StoredImage[]>([]);
  const ocrRunningRef = useRef(false);
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

  useEffect(() => {
    const stage = previewStageRef.current;
    if (!stage) return;
    const measure = () => {
      const bounds = stage.getBoundingClientRect();
      setPreviewStageSize((current) => (
        Math.abs(current.width - bounds.width) < 0.5 && Math.abs(current.height - bounds.height) < 0.5
          ? current
          : { width: bounds.width, height: bounds.height }
      ));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
  }, [ready]);

  const imageScaleFactors = useMemo(() => workspace.autoMatchTextSize
    ? getTextMatchScaleFactors(workspace.images)
    : new Map(workspace.images.map((image) => [image.id, 1])), [workspace.autoMatchTextSize, workspace.images]);
  const activeMetrics = useMemo(
    () => calculatePage(workspace, activePage, imageScaleFactors),
    [workspace, activePage, imageScaleFactors],
  );
  const activeImages = workspace.images.filter((image) => image.page === activePage);
  const activeTexts = workspace.texts.filter((text) => text.page === activePage);
  const selectedText = workspace.texts.find((text) => text.id === selectedItemId) ?? null;
  const previewImage = workspace.images.find((image) => image.id === previewImageId) ?? null;
  const movePreviewImage = useCallback((direction: -1 | 1) => {
    if (workspace.images.length < 2) return;
    const currentIndex = workspace.images.findIndex((image) => image.id === previewImageId);
    const nextIndex = (Math.max(0, currentIndex) + direction + workspace.images.length) % workspace.images.length;
    setPreviewImageId(workspace.images[nextIndex].id);
  }, [previewImageId, workspace.images]);

  useEffect(() => {
    if (!previewImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      movePreviewImage(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [movePreviewImage, previewImage]);

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
      return [];
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
    return newImages;
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

  const scanImagesForText = useCallback(async (imagesToScan: StoredImage[], manualRescan = false) => {
    if (imagesToScan.length === 0) return;
    if (ocrRunningRef.current) {
      const queuedIds = new Set(ocrQueueRef.current.map((image) => image.id));
      ocrQueueRef.current.push(...imagesToScan.filter((image) => !queuedIds.has(image.id)));
      return;
    }
    ocrRunningRef.current = true;
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
      for (const [index, image] of imagesToScan.entries()) {
        setOcrProgress(`Reading image ${index + 1} of ${imagesToScan.length}…`);
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
          if (!ratios.has(image.id)) return image;
          const ratio = ratios.get(image.id);
          return { ...image, ocrScanned: true, textHeightRatio: ratio ?? undefined };
        }).concat(imagesToScan.filter((image) => !current.images.some((existing) => existing.id === image.id))
          .map((image) => ({ ...image, ocrScanned: true, textHeightRatio: ratios.get(image.id) ?? undefined }))),
      }));
      if (manualRescan) {
        setErrorMessage(`Rescanned ${imagesToScan[0].name}. Text-size data updated.`);
      } else {
        const existingImages = new Map(workspace.images.map((image) => [image.id, image]));
        for (const image of imagesToScan) if (!existingImages.has(image.id)) existingImages.set(image.id, image);
        const nextImages = [...existingImages.values()].map((image) => ratios.has(image.id)
          ? { ...image, ocrScanned: true, textHeightRatio: ratios.get(image.id) ?? undefined }
          : image);
        const recognizedCount = nextImages.filter((image) => Number(image.textHeightRatio) > 0).length;
        setErrorMessage(recognizedCount > 0
          ? `Matched text size in ${recognizedCount} of ${nextImages.length} images.`
          : "No readable text found. Images keep their current sizes.");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? `Text detection failed: ${error.message}` : "Text detection failed.");
    } finally {
      await worker?.terminate().catch(() => undefined);
      ocrRunningRef.current = false;
      setOcrRunning(false);
      setOcrProgress("");
      const queued = ocrQueueRef.current.splice(0);
      if (queued.length > 0) void scanImagesForText(queued);
    }
  }, [workspace.images]);

  const matchTextSizes = useCallback(() => {
    if (workspace.images.length === 0 || ocrRunning) return;
    const unscannedImages = getUnscannedImages(workspace.images);
    if (unscannedImages.length === 0) {
      setErrorMessage("All images were already scanned. Use an image's Rescan OCR button to scan it again.");
      return;
    }
    void scanImagesForText(unscannedImages);
  }, [ocrRunning, scanImagesForText, workspace.images]);

  const rescanImageText = useCallback((image: StoredImage) => {
    void scanImagesForText([image], true);
  }, [scanImagesForText]);

  const onPaste = useCallback(async (event: ClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    const addedImages = await addFiles(files);
    if (workspace.autoOcrOnPaste && addedImages.length > 0) {
      void scanImagesForText(addedImages);
    }
  }, [addFiles, scanImagesForText, workspace.autoOcrOnPaste]);

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

  const addImageGroup = useCallback(() => {
    setWorkspace((current) => {
      const group = createImageGroup(current.groups, createId());
      return group ? { ...current, groups: [...current.groups, group] } : current;
    });
  }, []);

  const deleteImageGroup = useCallback((groupId: string) => {
    setWorkspace((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== groupId),
      images: current.images.map((image) => image.groupId === groupId
        ? { ...image, groupId: undefined }
        : image),
    }));
  }, []);

  const assignImageGroup = useCallback((imageId: string, groupId: string) => {
    setWorkspace((current) => ({
      ...current,
      images: current.images.map((image) => image.id === imageId
        ? { ...image, groupId: groupId === "none" ? undefined : groupId }
        : image),
    }));
  }, []);

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
          ? { ...text, content, fontSize, format: draftTextFormat }
          : text),
      }));
    } else {
      const contents = splitTextOnBlankLines ? splitTextBlocks(content) : [content];
      const texts: StoredText[] = contents.map((block) => ({
        id: createId(), page: targetPage, content: block, fontSize, format: draftTextFormat,
      }));
      setWorkspace((current) => ({ ...current, texts: [...current.texts, ...texts] }));
      setActivePage(targetPage);
      setSelectedItemId(texts[0]?.id ?? null);
    }
  }, [draftFontSize, draftText, draftTextFormat, selectedText, splitTextOnBlankLines, targetPage]);

  const startNewText = useCallback(() => {
    setSelectedItemId(null);
    setDraftText("");
    setDraftFontSize(16);
    setDraftTextFormat("plain");
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
  const previewSize = fitPageIntoFrame(
    activeMetrics.width,
    activeMetrics.height,
    Math.max(1, previewStageSize.width - 12),
    Math.max(1, previewStageSize.height - 12),
    previewZoom,
  );

  const changePreviewZoom = (factor: number) => {
    setPreviewZoom((current) => Math.min(3, Math.max(0.5, Number((current * factor).toFixed(2)))));
  };

  const averageTextHeightMm = estimateAveragePrintedTextHeightMm(
    activeImages,
    activeMetrics.layout.placements,
    workspace.borderMm,
  );

  const fitPreview = () => {
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
  };

  const onPreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewZoom <= 1 || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".sheet-image, .sheet-text")) return;
    panStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: previewPan.x,
      originY: previewPan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreviewPanning(true);
  };

  const onPreviewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPreviewPan({ x: start.originX + event.clientX - start.x, y: start.originY + event.clientY - start.y });
  };

  const endPreviewPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    panStartRef.current = null;
    setPreviewPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="app-shell" onPaste={onPaste}>
      <style>{`@media print {
        @page sheetPortrait { size: ${getPrintPageName(workspace.paper)} portrait; margin: 0; }
        @page sheetLandscape { size: ${getPrintPageName(workspace.paper)} landscape; margin: 0; }
      }`}</style>
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
          <Select
            value={workspace.orientation}
            onValueChange={(value) => {
              if (value === "auto" || value === "portrait" || value === "landscape") {
                setWorkspace((current) => ({ ...current, orientation: value }));
              }
            }}
          >
            <SelectTrigger className="toolbar-select" aria-label="Orientation"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="portrait">Portrait</SelectItem>
              <SelectItem value="landscape">Landscape</SelectItem>
            </SelectContent>
          </Select>
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
              <label className="auto-match-toggle">
                <input
                  type="checkbox"
                  checked={workspace.autoMatchTextSize}
                  onChange={(event) => setWorkspace((current) => ({ ...current, autoMatchTextSize: event.target.checked }))}
                  aria-label="Automatically match image text sizes"
                />
                <span>Automatically match detected text sizes</span>
              </label>
            </div>
            <div className="image-groups-control">
              <div className="image-groups-heading">
                <span>Image groups</span>
                <span className="image-group-count">{workspace.groups.length}/{MAX_IMAGE_GROUPS}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="new-image-group"
                  onClick={addImageGroup}
                  disabled={workspace.groups.length >= MAX_IMAGE_GROUPS}
                  aria-label="New image group"
                >
                  <Plus size={14} aria-hidden="true" />
                  New group
                </Button>
              </div>
              {workspace.groups.length > 0 ? (
                <>
                  <div className="image-group-list">
                    {workspace.groups.map((group) => (
                      <div className="image-group-chip" key={group.id}>
                        <span className="image-group-color" style={{ backgroundColor: group.color }} aria-hidden="true" />
                        <span>{group.name}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Delete ${group.name}`}
                          title={`Delete ${group.name}`}
                          onClick={() => deleteImageGroup(group.id)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="image-groups-note">Images in a group share its border color.</p>
                </>
              ) : (
                <p className="image-groups-note">Create a group to mark its images with one border color.</p>
              )}
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
            <label className="auto-ocr-toggle">
              <input
                type="checkbox"
                checked={workspace.autoOcrOnPaste}
                onChange={(event) => setWorkspace((current) => ({ ...current, autoOcrOnPaste: event.target.checked }))}
                aria-label="Auto OCR pasted images"
              />
              <span>Auto OCR on paste</span>
            </label>
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
              placeholder={draftTextFormat === "latex" ? "Enter LaTeX, for example \\frac{a}{b}…" : draftTextFormat === "markdown" ? "Paste a Markdown answer or table…" : "Write a caption or note…"}
              aria-label="Text block content"
            />
            <div className="text-controls">
              <label htmlFor="text-format">Format</label>
              <Select value={draftTextFormat} onValueChange={(value) => setDraftTextFormat(value === "latex" || value === "markdown" ? value : "plain")}>
                <SelectTrigger id="text-format" className="text-format-select" aria-label="Text format"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">Plain text</SelectItem>
                  <SelectItem value="latex">LaTeX math</SelectItem>
                  <SelectItem value="markdown">Markdown / ChatGPT answer</SelectItem>
                </SelectContent>
              </Select>
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
          <Button className="text-save-button" onClick={saveText} disabled={!draftText.trim()}>
                <Plus size={15} aria-hidden="true" />
                {selectedText ? "Save text" : "Add text block"}
              </Button>
            </div>
            <label className="split-text-toggle">
              <input
                type="checkbox"
                checked={splitTextOnBlankLines}
                onChange={(event) => setSplitTextOnBlankLines(event.target.checked)}
                aria-label="Split text at blank lines"
              />
              <span>Arrange blank-line sections separately for better space use</span>
            </label>
            <p className="storage-note">Markdown supports tables, bold text and inline math. LaTeX accepts MathJax delimiters such as $$…$$.</p>
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
                  <div className={`item-row image-item-row${selectedItemId === image.id ? " item-selected" : ""}`} key={image.id}>
                    <button className="item-thumb-preview" type="button" onClick={() => setPreviewImageId(image.id)} aria-label={`Preview full image ${image.name}`} title="View full image">
                    <span
                      className="item-thumb"
                      style={{ borderColor: workspace.groups.find((group) => group.id === image.groupId)?.color }}
                    >
                      <PageImage image={image} src={imageUrls.get(image.id)} />
                    </span>
                    </button>
                    <button className="item-main" type="button" onClick={() => onImageItemClick(image)} aria-label={`Select ${image.name}`}>
                      <span className="item-label-stack">
                        <span className="item-name">{image.name}</span>
                        <span className="image-text-size" title="Estimated median OCR text height at this image's current print size">
                          {printedTextSizeLabel(
                            image,
                            activeMetrics.layout.placements.find((placement) => placement.id === image.id),
                            workspace.borderMm,
                          )}
                        </span>
                      </span>
                      <span className="ocr-flag" role="status" aria-label={`OCR status for ${image.name}`} data-result={getOcrStatusLabel(image)} title={getOcrStatusLabel(image)}>
                        {getOcrStatusLabel(image) === "Text found" ? "OCR ✓" : getOcrStatusLabel(image) === "No text found" ? "OCR —" : "OCR ?"}
                      </span>
                    </button>
                    <Button variant="ghost" size="icon-xs" className="rescan-ocr" aria-label={`Rescan OCR for ${image.name}`} title="Rescan OCR" disabled={ocrRunning} onClick={() => rescanImageText(image)}><RotateCw size={14} /></Button>
                    <div className="image-item-assignments">
                      <Select value={String(image.page)} onValueChange={(value) => assignItem(image.id, Number(value))}>
                        <SelectTrigger className="item-page-select" aria-label={`Page for ${image.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{pageOptions.map((page) => <SelectItem key={page} value={String(page)}>Page {page}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={image.groupId ?? "none"} onValueChange={(value) => assignImageGroup(image.id, value)}>
                        <SelectTrigger
                          className="item-group-select"
                          aria-label={`Group for ${image.name}`}
                          style={{ borderColor: workspace.groups.find((group) => group.id === image.groupId)?.color }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No group</SelectItem>
                          {workspace.groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
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
                      setDraftTextFormat(text.format === "latex" || text.format === "markdown" ? text.format : "plain");
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
            <div className="preview-actions">
              <div className="preview-summary">
                <div className="preview-spec">{currentPaper.label} · {workspace.orientation === "auto" ? `Auto · ${activeMetrics.orientation}` : workspace.orientation[0].toUpperCase() + workspace.orientation.slice(1)} · {workspace.marginMm} mm edge · {workspace.borderMm} mm border · {workspace.gapMm} mm gap</div>
                <div className="preview-average" role="status">Average printed text {averageTextHeightMm === null ? "—" : `≈ ${averageTextHeightMm.toFixed(1)} mm`}</div>
              </div>
              <div className="zoom-controls" aria-label="Page zoom controls">
                <Button variant="outline" size="icon-sm" aria-label="Zoom out" onClick={() => changePreviewZoom(1 / 1.25)} disabled={previewZoom <= 0.5}>
                  <Minus size={15} aria-hidden="true" />
                </Button>
                <span className="zoom-level" aria-label="Zoom level">{Math.round(previewZoom * 100)}%</span>
                <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => changePreviewZoom(1.25)} disabled={previewZoom >= 3}>
                  <Plus size={15} aria-hidden="true" />
                </Button>
                <Button variant="outline" size="sm" aria-label="Fit page" onClick={fitPreview}>Fit page</Button>
              </div>
            </div>
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
              <div
                ref={previewStageRef}
                className={`paper-stage${previewZoom > 1 ? " is-zoomed" : ""}${previewPanning ? " is-panning" : ""}`}
                onPointerDown={onPreviewPointerDown}
                onPointerMove={onPreviewPointerMove}
                onPointerUp={endPreviewPan}
                onPointerCancel={endPreviewPan}
              >
                <div
                  className="paper-zoom-layer"
                  style={{
                    width: `${previewSize.width}px`,
                    height: `${previewSize.height}px`,
                    transform: `translate(calc(-50% + ${previewPan.x}px), calc(-50% + ${previewPan.y}px))`,
                  }}
                >
                <PageSheet
                  workspace={workspace}
                  imageUrls={imageUrls}
                  pageNumber={activePage}
                  metrics={activeMetrics}
                  selectedItemId={selectedItemId}
                  onSelect={setSelectedItemId}
                  previewSize={previewSize}
                />
                </div>
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

      <Dialog open={previewImage !== null} onOpenChange={(open) => {
        if (!open) setPreviewImageId(null);
      }}>
        {previewImage ? (
          <DialogContent className="image-preview-dialog">
            <DialogHeader>
              <DialogTitle>{previewImage.name}</DialogTitle>
              <DialogDescription>{previewImage.width} × {previewImage.height} px · original image</DialogDescription>
            </DialogHeader>
            <div className="image-preview-navigation">
              <Button variant="outline" size="sm" aria-label="Previous image" onClick={() => movePreviewImage(-1)} disabled={workspace.images.length < 2}>
                <ChevronLeft size={16} aria-hidden="true" /> Previous
              </Button>
              <span className="image-preview-count">{workspace.images.findIndex((image) => image.id === previewImage.id) + 1} of {workspace.images.length} images</span>
              <Button variant="outline" size="sm" aria-label="Next image" onClick={() => movePreviewImage(1)} disabled={workspace.images.length < 2}>
                Next <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </div>
            <p className="image-preview-key-hint">Use ← and → to browse images</p>
            <div className="full-image-preview">
              <img src={imageUrls.get(previewImage.id)} alt={previewImage.name} />
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
