import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, catchError, debounceTime, forkJoin, of, takeUntil } from 'rxjs';
import { ApiService, OverlayLayer } from '../services/api.service';
import { I18nService } from '../services/i18n.service';

const DEFAULT_CSS =
  'position:absolute;left:24px;bottom:24px;color:#fff;font:600 28px/1.3 sans-serif;text-shadow:0 2px 6px rgba(0,0,0,.8);';
const DEFAULT_DRAWING_PATH = 'M8 70 C 22 12, 38 88, 52 34 S 80 18, 92 70';

function createLayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `layer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Tokens available to authors of an overlay template.
const TOKENS = ['{filename}', '{parentFolder}'];
const KNOWN_CSS_PROPERTIES = new Set([
  'position',
  'left',
  'right',
  'top',
  'bottom',
  'transform',
  'max-width',
  'color',
  'font',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-radius',
  'background',
  'background-color',
  'text-shadow',
  'display',
  'box-sizing',
  'white-space',
  'width',
  'height',
  'opacity',
  'z-index',
  'mix-blend-mode',
  'overflow',
  'object-fit',
  'border',
  'border-style',
  'border-width',
  'border-color',
  'aspect-ratio',
  'filter',
]);

type OverlayType = 'text' | 'bar' | 'square' | 'circle' | 'image' | 'drawing';
type HorizontalAlign = 'left' | 'center' | 'right';
type VerticalAlign = 'top' | 'center' | 'bottom';
type TextTransformOption = 'none' | 'uppercase' | 'lowercase' | 'capitalize';
type BlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'soft-light';
type ObjectFitOption = 'contain' | 'cover';
type InspectorTab = 'general' | 'placement' | 'style' | 'effects' | 'advanced';

interface QuickAddOption {
  type: OverlayType;
  labelKey: string;
  descriptionKey: string;
}

interface TokenOption {
  token: string;
  labelKey: string;
  descriptionKey: string;
}

type DragMode = 'move' | 'resize';

interface PointerSession {
  pointerId: number;
  layerId: string;
  mode: DragMode;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface DesignerLayer extends OverlayLayer {
  type: OverlayType;
  hAlign: HorizontalAlign;
  vAlign: VerticalAlign;
  offsetX: number;
  offsetY: number;
  maxWidth: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  zIndex: number;
  blendMode: BlendMode;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  lineHeight: number;
  letterSpacing: number;
  textAlign: HorizontalAlign;
  textTransform: TextTransformOption;
  paddingX: number;
  paddingY: number;
  borderRadius: number;
  shadow: boolean;
  shadowColor: string;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffsetY: number;
  borderColor: string;
  borderOpacity: number;
  borderWidth: number;
  source: string;
  fit: ObjectFitOption;
  pathData: string;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  fillColor: string;
  fillOpacity: number;
  advancedCss: string;
}

const QUICK_ADD_OPTIONS: QuickAddOption[] = [
  { type: 'text', labelKey: 'overlay.quickadd.text.label', descriptionKey: 'overlay.quickadd.text.description' },
  { type: 'image', labelKey: 'overlay.quickadd.image.label', descriptionKey: 'overlay.quickadd.image.description' },
  { type: 'bar', labelKey: 'overlay.quickadd.bar.label', descriptionKey: 'overlay.quickadd.bar.description' },
  { type: 'square', labelKey: 'overlay.quickadd.square.label', descriptionKey: 'overlay.quickadd.square.description' },
  { type: 'circle', labelKey: 'overlay.quickadd.circle.label', descriptionKey: 'overlay.quickadd.circle.description' },
  { type: 'drawing', labelKey: 'overlay.quickadd.drawing.label', descriptionKey: 'overlay.quickadd.drawing.description' },
];

const TOKEN_OPTIONS: TokenOption[] = [
  { token: '{filename}', labelKey: 'token.filename.label', descriptionKey: 'token.filename.description' },
  { token: '{filenameNoExt}', labelKey: 'token.filenameNoExt.label', descriptionKey: 'token.filenameNoExt.description' },
  { token: '{extension}', labelKey: 'token.extension.label', descriptionKey: 'token.extension.description' },
  { token: '{parentFolder}', labelKey: 'token.parentFolder.label', descriptionKey: 'token.parentFolder.description' },
  { token: '{folderPath}', labelKey: 'token.folderPath.label', descriptionKey: 'token.folderPath.description' },
  { token: '{filePath}', labelKey: 'token.filePath.label', descriptionKey: 'token.filePath.description' },
  { token: '{index}', labelKey: 'token.index.label', descriptionKey: 'token.index.description' },
  { token: '{total}', labelKey: 'token.total.label', descriptionKey: 'token.total.description' },
];

interface PreviewResolution {
  key: string;
  width: number;
  height: number;
}

interface OverlayPreviewContext {
  filename: string;
  filenameNoExt: string;
  extension: string;
  parentFolder: string;
  folderPath: string;
  filePath: string;
  index: number;
  total: number;
}

@Component({
  selector: 'app-overlay-designer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatSelectModule,
  ],
  templateUrl: './overlay-designer.component.html',
  styleUrl: './overlay-designer.component.scss',
})
export class OverlayDesignerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('stageViewport') private stageViewport?: ElementRef<HTMLElement>;

  readonly previewResolutions: PreviewResolution[] = [
    { key: '1920x1080', width: 1920, height: 1080 },
    { key: '1280x720', width: 1280, height: 720 },
    { key: '3840x2160', width: 3840, height: 2160 },
    { key: '1080x1920', width: 1080, height: 1920 },
    { key: '1080x1080', width: 1080, height: 1080 },
  ];
  previewResolutionKey = '1920x1080';
  previewWidth = 1920;
  previewHeight = 1080;
  previewScale = 1;
  inspectorTab: InspectorTab = 'general';
  quickAddOpen = false;
  designerLayers: DesignerLayer[] = [];
  tokens = TOKENS;
  tokenOptions = TOKEN_OPTIONS;
  quickAddOptions = QUICK_ADD_OPTIONS;
  overlayTypes = QUICK_ADD_OPTIONS.map((option) => option.type);
  loaded = false;
  selectedLayerIndex = 0;
  bodyBackgroundColor = '#000000';
  autosaveLabel = '';
  autosaveDirty = false;
  libraryFiles: string[] = [];

  private readonly destroy$ = new Subject<void>();
  private readonly autosave$ = new Subject<void>();
  private activePointerSession: PointerSession | null = null;
  private saveInFlight = false;
  private saveQueuedWhileBusy = false;
  private stageResizeObserver?: ResizeObserver;

  constructor(private api: ApiService, private snackBar: MatSnackBar, public i18n: I18nService) {}

  ngOnInit(): void {
    this.autosaveLabel = this.i18n.t('overlay.autosave.ready');
    this.autosave$
      .pipe(debounceTime(450), takeUntil(this.destroy$))
      .subscribe(() => this.persistChanges(true));

    forkJoin({
      layers: this.api.getOverlays().pipe(catchError(() => of([] as OverlayLayer[]))),
      settings: this.api.getSettings().pipe(catchError(() => of({} as Record<string, string>))),
      media: this.api.getMediaOrder().pipe(catchError(() => of({ files: [], order: [], hidden: [] }))),
    }).subscribe(({ layers, settings, media }) => {
      this.designerLayers = layers.map((layer) => this.createDesignerLayer(layer));
      this.bodyBackgroundColor = this.normalizeColorInput(settings['bodyBackgroundColor'], '#000000');
      this.libraryFiles = media.files.filter((file) => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
      if (this.designerLayers.length === 0) this.addLayer('text');
      this.loaded = true;
      setTimeout(() => this.initializeStageObserver());
    });
  }

  ngAfterViewInit(): void {
    this.initializeStageObserver();
  }

  ngOnDestroy(): void {
    this.stageResizeObserver?.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }

  setPreviewResolution(key: string): void {
    const resolution = this.previewResolutions.find((entry) => entry.key === key);
    if (!resolution) return;
    this.previewWidth = resolution.width;
    this.previewHeight = resolution.height;
    this.updatePreviewScale();
  }

  @HostListener('input')
  onAnyInputChange(): void {
    this.queueAutosave();
  }

  @HostListener('change')
  onAnyControlChange(): void {
    this.queueAutosave();
  }

  @HostListener('window:pointermove', ['$event'])
  onWindowPointerMove(event: PointerEvent): void {
    if (!this.activePointerSession || event.pointerId !== this.activePointerSession.pointerId) return;

    const layer = this.designerLayers.find((entry) => entry.id === this.activePointerSession?.layerId);
    if (!layer) return;

    const deltaX = event.clientX - this.activePointerSession.startX;
    const deltaY = event.clientY - this.activePointerSession.startY;

    if (this.activePointerSession.mode === 'move') {
      layer.offsetX = this.roundDragValue(this.activePointerSession.offsetX + this.translateHorizontalDelta(layer, deltaX / this.previewScale));
      layer.offsetY = this.roundDragValue(this.activePointerSession.offsetY + this.translateVerticalDelta(layer, deltaY / this.previewScale));
    } else {
      layer.width = Math.max(16, this.roundDragValue(this.activePointerSession.width + this.translateHorizontalDeltaForResize(layer, deltaX / this.previewScale)));
      layer.height = Math.max(16, this.roundDragValue(this.activePointerSession.height + this.translateVerticalDeltaForResize(layer, deltaY / this.previewScale)));
    }

    this.autosaveDirty = true;
    this.autosaveLabel = this.activePointerSession.mode === 'move' ? this.i18n.t('overlay.autosave.dragging') : this.i18n.t('overlay.autosave.resizing');
  }

  @HostListener('window:pointerup', ['$event'])
  onWindowPointerUp(event: PointerEvent): void {
    if (!this.activePointerSession || event.pointerId !== this.activePointerSession.pointerId) return;
    this.activePointerSession = null;
    this.queueAutosave();
  }

  addLayer(type: OverlayType = 'text'): void {
    this.designerLayers.push(this.createDesignerLayer({
      id: createLayerId(),
      type,
      template: type === 'text' ? '{filename}' : '',
      css: DEFAULT_CSS,
      enabled: true,
    }));
    this.selectedLayerIndex = this.designerLayers.length - 1;
    this.quickAddOpen = false;
    this.queueAutosave();
  }

  toggleQuickAdd(): void {
    this.quickAddOpen = !this.quickAddOpen;
  }

  removeLayer(id: string): void {
    this.designerLayers = this.designerLayers.filter((layer) => layer.id !== id);
    this.selectedLayerIndex = Math.max(0, Math.min(this.selectedLayerIndex, this.designerLayers.length - 1));
    if (this.designerLayers.length === 0) this.addLayer();
    this.queueAutosave();
  }

  selectLayer(index: number): void {
    this.selectedLayerIndex = index;
  }

  duplicateActiveLayer(): void {
    const layer = this.activeLayer;
    if (!layer) return;
    const duplicate = this.createDesignerLayer({
      ...this.toOverlayLayer(layer),
      id: createLayerId(),
    });
    duplicate.offsetX += 18;
    duplicate.offsetY += 18;
    this.designerLayers.splice(this.selectedLayerIndex + 1, 0, duplicate);
    this.selectedLayerIndex += 1;
    this.queueAutosave();
  }

  moveLayer(direction: -1 | 1): void {
    const current = this.selectedLayerIndex;
    const target = current + direction;
    if (target < 0 || target >= this.designerLayers.length) return;
    const [layer] = this.designerLayers.splice(current, 1);
    this.designerLayers.splice(target, 0, layer);
    this.selectedLayerIndex = target;
    this.queueAutosave();
  }

  insertToken(layer: DesignerLayer, token: string): void {
    layer.template += token;
    this.queueAutosave();
  }

  setPreset(layer: DesignerLayer, hAlign: HorizontalAlign, vAlign: VerticalAlign): void {
    layer.hAlign = hAlign;
    layer.vAlign = vAlign;
    this.queueAutosave();
  }

  normalizeBodyBackgroundColor(): void {
    this.bodyBackgroundColor = this.normalizeColorInput(this.bodyBackgroundColor, '#000000');
    this.queueAutosave();
  }

  startDrag(event: PointerEvent, index: number): void {
    if ((event.target as HTMLElement)?.closest('.resize-handle')) return;
    const layer = this.designerLayers[index];
    if (!layer) return;
    this.selectedLayerIndex = index;
    this.activePointerSession = {
      pointerId: event.pointerId,
      layerId: layer.id,
      mode: 'move',
      startX: event.clientX,
      startY: event.clientY,
      offsetX: layer.offsetX,
      offsetY: layer.offsetY,
      width: layer.width,
      height: layer.height,
    };
    event.preventDefault();
    event.stopPropagation();
  }

  startResize(event: PointerEvent, index: number): void {
    const layer = this.designerLayers[index];
    if (!layer || !this.usesFixedSize(layer)) return;
    this.selectedLayerIndex = index;
    this.activePointerSession = {
      pointerId: event.pointerId,
      layerId: layer.id,
      mode: 'resize',
      startX: event.clientX,
      startY: event.clientY,
      offsetX: layer.offsetX,
      offsetY: layer.offsetY,
      width: layer.width,
      height: layer.height,
    };
    event.preventDefault();
    event.stopPropagation();
  }

  applyTypePreset(layer: DesignerLayer, type: OverlayType): void {
    layer.type = type;

    if (type === 'text' && !layer.template) layer.template = '{filename}';
    if (type === 'image' && !layer.source) layer.source = '';
    if (type === 'drawing' && !layer.pathData) layer.pathData = DEFAULT_DRAWING_PATH;

    if (type === 'text') {
      layer.width = 420;
      layer.height = 120;
      layer.maxWidth = 48;
      layer.paddingX = 0;
      layer.paddingY = 0;
      layer.backgroundOpacity = Math.max(layer.backgroundOpacity, 0);
    }

    if (type === 'bar') {
      layer.width = 420;
      layer.height = 18;
      layer.backgroundOpacity = 100;
      layer.borderRadius = 999;
      layer.shadow = false;
      layer.template = '';
    }

    if (type === 'square') {
      layer.width = 180;
      layer.height = 180;
      layer.backgroundOpacity = 100;
      layer.shadow = false;
      layer.template = '';
    }

    if (type === 'circle') {
      layer.width = 180;
      layer.height = 180;
      layer.backgroundOpacity = 100;
      layer.borderRadius = 999;
      layer.shadow = false;
      layer.template = '';
    }

    if (type === 'image') {
      layer.width = 220;
      layer.height = 220;
      layer.backgroundOpacity = 0;
      layer.borderRadius = Math.max(layer.borderRadius, 12);
      layer.shadow = false;
      layer.template = '';
    }

    if (type === 'drawing') {
      layer.width = 240;
      layer.height = 140;
      layer.backgroundOpacity = 0;
      layer.fillOpacity = 0;
      layer.strokeOpacity = 100;
      layer.shadow = false;
      layer.template = '';
    }

    this.queueAutosave();
  }

  browseImage(layer: DesignerLayer): void {
    if (this.libraryFiles.length === 0) {
      this.snackBar.open(this.i18n.t('settings.libraryEmpty'), this.i18n.t('ok'), { duration: 3000 });
    }
  }

  isTextLayer(layer: DesignerLayer): boolean {
    return layer.type === 'text';
  }

  isImageLayer(layer: DesignerLayer): boolean {
    return layer.type === 'image';
  }

  isDrawingLayer(layer: DesignerLayer): boolean {
    return layer.type === 'drawing';
  }

  usesFixedSize(layer: DesignerLayer): boolean {
    return layer.type !== 'text';
  }

  previewLayerSource(layer: DesignerLayer): string {
    if (!layer.source) return '';
    if (/^(https?:|data:|blob:)/i.test(layer.source)) return layer.source;

    let source = layer.source;
    if (/^file:/i.test(source)) {
      try {
        source = decodeURIComponent(new URL(source).pathname);
        if (/^\/[a-zA-Z]:/.test(source)) source = source.slice(1);
      } catch {
        return '';
      }
    }

    if (/^[a-zA-Z]:[\\/]/.test(source) || source.startsWith('/') || /^\/\//.test(source)) {
      return `/api/local-file?path=${encodeURIComponent(source)}`;
    }

    return `/media/${source.replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
  }

  previewFill(layer: DesignerLayer): string {
    return this.toRgba(layer.fillColor, layer.fillOpacity / 100);
  }

  previewStroke(layer: DesignerLayer): string {
    return this.toRgba(layer.strokeColor, layer.strokeOpacity / 100);
  }

  previewText(layer: OverlayLayer): string {
    return this.renderTemplate(layer.template, {
      filename: 'sunset.jpg',
      filenameNoExt: 'sunset',
      extension: 'jpg',
      parentFolder: 'Exhibition 2026',
      folderPath: 'events/Exhibition 2026',
      filePath: 'events/Exhibition 2026/sunset.jpg',
      index: 12,
      total: 48,
    });
  }

  buildLayerCss(layer: DesignerLayer): string {
    const parts = ['position:absolute', 'display:block', 'box-sizing:border-box', `opacity:${layer.opacity / 100}`, `z-index:${layer.zIndex}`];
    const transform: string[] = [];

    if (layer.hAlign === 'left') parts.push(`left:${layer.offsetX}px`);
    if (layer.hAlign === 'center') {
      parts.push(`left:${this.calcCenterOffset(layer.offsetX)}`);
      transform.push('translateX(-50%)');
    }
    if (layer.hAlign === 'right') parts.push(`right:${layer.offsetX}px`);

    if (layer.vAlign === 'top') parts.push(`top:${layer.offsetY}px`);
    if (layer.vAlign === 'center') {
      parts.push(`top:${this.calcCenterOffset(layer.offsetY)}`);
      transform.push('translateY(-50%)');
    }
    if (layer.vAlign === 'bottom') parts.push(`bottom:${layer.offsetY}px`);

    if (layer.rotation !== 0) transform.push(`rotate(${layer.rotation}deg)`);
    if (transform.length > 0) parts.push(`transform:${transform.join(' ')}`);

    parts.push(`mix-blend-mode:${layer.blendMode}`);

    if (layer.type === 'text') {
      parts.push(
        'display:inline-block',
        'white-space:pre-wrap',
        `max-width:${layer.maxWidth}%`,
        `color:${layer.textColor}`,
        `background:${this.toRgba(layer.backgroundColor, layer.backgroundOpacity / 100)}`,
        `font-size:${layer.fontSize}px`,
        `font-weight:${layer.fontWeight}`,
        `font-family:${layer.fontFamily}`,
        `line-height:${layer.lineHeight}`,
        `letter-spacing:${layer.letterSpacing}px`,
        `text-align:${layer.textAlign}`,
        `text-transform:${layer.textTransform}`,
        `padding:${layer.paddingY}px ${layer.paddingX}px`,
        `border-radius:${layer.borderRadius}px`,
      );
    } else {
      parts.push(
        `width:${layer.width}px`,
        `height:${layer.height}px`,
        `background:${this.toRgba(layer.backgroundColor, layer.backgroundOpacity / 100)}`,
        `border-radius:${layer.type === 'circle' ? 9999 : layer.borderRadius}px`,
        `overflow:hidden`,
      );
    }

    if (layer.type === 'image') {
      parts.push(`object-fit:${layer.fit}`);
    }

    if (layer.type === 'bar') {
      parts.push(`border-radius:${layer.borderRadius}px`);
    }

    if (layer.type === 'drawing') {
      parts.push('background:transparent');
    }

    if (layer.borderWidth > 0) {
      parts.push(`border:${layer.borderWidth}px solid ${this.toRgba(layer.borderColor, layer.borderOpacity / 100)}`);
    }

    if (layer.shadow && layer.type === 'text') {
      parts.push(`text-shadow:0 ${layer.shadowOffsetY}px ${layer.shadowBlur}px ${this.toRgba(layer.shadowColor, layer.shadowOpacity / 100)}`);
    }

    if (layer.advancedCss.trim()) parts.push(layer.advancedCss.trim().replace(/;+$/, ''));
    return parts.join(';') + ';';
  }

  layerLabel(layer: DesignerLayer, index: number): string {
    const preview = layer.type === 'text' ? this.previewText(layer).trim() : (layer.source || layer.type);
    if (preview) return preview.slice(0, 36);
    return `${this.i18n.t('overlay.layer')} ${index + 1}`;
  }

  layerTypeLabel(layer: DesignerLayer): string {
    const key = `overlay.quickadd.${layer.type}.label`;
    const translated = this.i18n.t(key);
    if (translated && translated !== key) return translated;
    return layer.type[0].toUpperCase() + layer.type.slice(1);
  }

  trackLayer(_index: number, layer: DesignerLayer): string {
    return layer.id;
  }

  get activeLayer(): DesignerLayer | null {
    return this.designerLayers[this.selectedLayerIndex] ?? null;
  }

  save(): void {
    this.persistChanges(false);
  }

  private queueAutosave(): void {
    if (!this.loaded) return;
    this.autosaveDirty = true;
    this.autosaveLabel = this.i18n.t('overlay.autosave.pending') || 'Autosave pending...';
    this.autosave$.next();
  }

  private updatePreviewScale(): void {
    const viewport = this.stageViewport?.nativeElement;
    if (!viewport) return;
    this.previewScale = Math.max(0.01, Math.min(
      viewport.clientWidth / this.previewWidth,
      viewport.clientHeight / this.previewHeight,
    ));
  }

  private initializeStageObserver(): void {
    const viewport = this.stageViewport?.nativeElement;
    if (!viewport || this.stageResizeObserver) return;
    this.updatePreviewScale();
    this.stageResizeObserver = new ResizeObserver(() => this.updatePreviewScale());
    this.stageResizeObserver.observe(viewport);
  }

  private persistChanges(silent: boolean): void {
    if (!this.loaded) return;
    if (this.saveInFlight) {
      this.saveQueuedWhileBusy = true;
      return;
    }

    const layers = this.designerLayers.map((layer) => this.toOverlayLayer(layer));
    this.bodyBackgroundColor = this.normalizeColorInput(this.bodyBackgroundColor, '#000000');
    this.saveInFlight = true;
    this.autosaveLabel = silent ? this.i18n.t('overlay.autosave.autosaving') || 'Autosaving...' : this.i18n.t('overlay.autosave.saving') || 'Saving...';

    forkJoin([
      this.api.saveOverlays(layers),
      this.api.saveSettings({ bodyBackgroundColor: this.bodyBackgroundColor }),
    ]).subscribe({
      next: () => {
        this.saveInFlight = false;
        this.autosaveDirty = false;
        this.autosaveLabel = this.i18n.t('overlay.autosave.saved') || 'All changes saved';
        if (!silent) {
          this.snackBar.open(this.i18n.t('overlay.save.successMessage'), this.i18n.t('ok'), { duration: 3000 });
        }
        if (this.saveQueuedWhileBusy) {
          this.saveQueuedWhileBusy = false;
          this.queueAutosave();
        }
      },
      error: () => {
        this.saveInFlight = false;
        this.autosaveDirty = true;
        this.autosaveLabel = this.i18n.t('overlay.autosave.failed') || 'Autosave failed';
        this.snackBar.open(this.i18n.t('overlay.save.failedMessage'), this.i18n.t('ok'), { duration: 3000 });
      },
    });
  }

  private createDesignerLayer(layer: OverlayLayer): DesignerLayer {
    const style = document.createElement('div').style;
    style.cssText = layer.css;
    const type = this.detectType(layer, style);
    const background = this.parseColor(style.backgroundColor, '#000000', 0);
    const shadow = this.parseShadow(style.textShadow);
    const border = this.parseBorder(style);

    const designerLayer: DesignerLayer = {
      ...layer,
      type,
      hAlign: this.detectHorizontalAlign(style),
      vAlign: this.detectVerticalAlign(style),
      offsetX: this.detectHorizontalOffset(style),
      offsetY: this.detectVerticalOffset(style),
      maxWidth: this.readPercent(style.maxWidth, 48),
      width: this.readPixel(style.width, type === 'bar' ? 420 : 220),
      height: this.readPixel(style.height, type === 'bar' ? 18 : 220),
      opacity: this.readOpacity(style.opacity, 100),
      rotation: this.readRotation(style.transform),
      zIndex: this.readNumber(style.zIndex, 1),
      blendMode: this.readBlendMode(style.mixBlendMode),
      textColor: this.parseColor(style.color, '#ffffff').hex,
      backgroundColor: background.hex,
      backgroundOpacity: background.alpha,
      fontSize: this.readPixel(style.fontSize, 28),
      fontWeight: this.readNumber(style.fontWeight, 600),
      fontFamily: style.fontFamily || 'sans-serif',
      lineHeight: this.readLineHeight(style.lineHeight, 1.3),
      letterSpacing: this.readPixel(style.letterSpacing, 0),
      textAlign: this.readTextAlign(style.textAlign),
      textTransform: this.readTextTransform(style.textTransform),
      paddingX: this.readPixel(style.paddingLeft, 0),
      paddingY: this.readPixel(style.paddingTop, 0),
      borderRadius: this.readPixel(style.borderRadius, 0),
      shadow: shadow.enabled,
      shadowColor: shadow.hex,
      shadowOpacity: shadow.alpha,
      shadowBlur: shadow.blur,
      shadowOffsetY: shadow.offsetY,
      borderColor: border.hex,
      borderOpacity: border.alpha,
      borderWidth: border.width,
      source: layer.source ?? '',
      fit: layer.fit ?? this.readObjectFit(style.objectFit),
      pathData: layer.pathData ?? DEFAULT_DRAWING_PATH,
      strokeColor: this.normalizeColorInput(layer.strokeColor, '#ffffff'),
      strokeOpacity: this.readPercentNumber(layer.strokeOpacity, 100),
      strokeWidth: layer.strokeWidth ?? 6,
      fillColor: this.normalizeColorInput(layer.fillColor, '#000000'),
      fillOpacity: this.readPercentNumber(layer.fillOpacity, 0),
      advancedCss: this.extractAdvancedCss(layer.css),
    };

    if (!designerLayer.source && type === 'image') designerLayer.source = '';
    if (type === 'drawing') {
      designerLayer.width = this.readPixel(style.width, 240);
      designerLayer.height = this.readPixel(style.height, 140);
      designerLayer.strokeColor = this.normalizeColorInput(layer.strokeColor, '#ffffff');
      designerLayer.strokeOpacity = this.readPercentNumber(layer.strokeOpacity, 100);
      designerLayer.strokeWidth = layer.strokeWidth ?? 6;
      designerLayer.fillColor = this.normalizeColorInput(layer.fillColor, '#000000');
      designerLayer.fillOpacity = this.readPercentNumber(layer.fillOpacity, 0);
      designerLayer.backgroundOpacity = 0;
    }

    this.applyTypePreset(designerLayer, designerLayer.type);
    if (layer.type === designerLayer.type) {
      designerLayer.width = this.readPixel(style.width, designerLayer.width);
      designerLayer.height = this.readPixel(style.height, designerLayer.height);
      designerLayer.backgroundOpacity = background.alpha;
      designerLayer.borderRadius = this.readPixel(style.borderRadius, designerLayer.borderRadius);
    }

    return designerLayer;
  }

  private toOverlayLayer(layer: DesignerLayer): OverlayLayer {
    return {
      id: layer.id,
      type: layer.type,
      template: layer.type === 'text' ? layer.template : '',
      css: this.buildLayerCss(layer),
      enabled: layer.enabled,
      source: layer.type === 'image' ? layer.source : undefined,
      fit: layer.type === 'image' ? layer.fit : undefined,
      pathData: layer.type === 'drawing' ? layer.pathData : undefined,
      strokeColor: layer.type === 'drawing' ? this.normalizeColorInput(layer.strokeColor, '#ffffff') : undefined,
      strokeOpacity: layer.type === 'drawing' ? this.readPercentNumber(layer.strokeOpacity, 100) : undefined,
      strokeWidth: layer.type === 'drawing' ? layer.strokeWidth : undefined,
      fillColor: layer.type === 'drawing' ? this.normalizeColorInput(layer.fillColor, '#000000') : undefined,
      fillOpacity: layer.type === 'drawing' ? this.readPercentNumber(layer.fillOpacity, 0) : undefined,
    };
  }

  private detectType(layer: OverlayLayer, style: CSSStyleDeclaration): OverlayType {
    if (layer.type) return layer.type;
    if (layer.source) return 'image';

    const width = this.readPixel(style.width, 0);
    const height = this.readPixel(style.height, 0);
    const radius = this.readPixel(style.borderRadius, 0);

    if (width > 0 && height > 0) {
      if (radius >= Math.min(width, height) / 2) return 'circle';
      if (Math.abs(width - height) < 2) return 'square';
      if (height <= 24 || width <= 24) return 'bar';
    }

    return layer.template ? 'text' : 'bar';
  }

  private translateHorizontalDelta(layer: DesignerLayer, delta: number): number {
    if (layer.hAlign === 'right') return -delta;
    return delta;
  }

  private translateVerticalDelta(layer: DesignerLayer, delta: number): number {
    if (layer.vAlign === 'bottom') return -delta;
    return delta;
  }

  private translateHorizontalDeltaForResize(layer: DesignerLayer, delta: number): number {
    if (layer.hAlign === 'center') return delta * 2;
    if (layer.hAlign === 'right') return -delta;
    return delta;
  }

  private translateVerticalDeltaForResize(layer: DesignerLayer, delta: number): number {
    if (layer.vAlign === 'center') return delta * 2;
    if (layer.vAlign === 'bottom') return -delta;
    return delta;
  }

  private roundDragValue(value: number): number {
    return Math.round(value);
  }

  private detectHorizontalAlign(style: CSSStyleDeclaration): HorizontalAlign {
    if (style.right) return 'right';
    if (style.left.includes('50%')) return 'center';
    return 'left';
  }

  private detectVerticalAlign(style: CSSStyleDeclaration): VerticalAlign {
    if (style.top.includes('50%')) return 'center';
    if (style.top) return 'top';
    return 'bottom';
  }

  private detectHorizontalOffset(style: CSSStyleDeclaration): number {
    if (style.right) return this.readPixel(style.right, 24);
    return this.readCenterOffset(style.left, 24);
  }

  private detectVerticalOffset(style: CSSStyleDeclaration): number {
    if (style.top && !style.top.includes('50%')) return this.readPixel(style.top, 24);
    if (style.bottom) return this.readPixel(style.bottom, 24);
    return this.readCenterOffset(style.top, 24);
  }

  private readCenterOffset(value: string, fallback: number): number {
    if (!value) return fallback;
    if (value === '50%') return 0;
    const match = value.match(/calc\(50%\s*([+-])\s*(\d+(?:\.\d+)?)px\)/);
    if (!match) return this.readPixel(value, fallback);
    const amount = Number(match[2]);
    return match[1] === '-' ? -amount : amount;
  }

  private calcCenterOffset(offset: number): string {
    if (offset === 0) return '50%';
    return `calc(50% ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}px)`;
  }

  private readPixel(value: string, fallback: number): number {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private readNumber(value: string, fallback: number): number {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private readPercent(value: string, fallback: number): number {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private readPercentNumber(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value as number)) : fallback;
  }

  private readOpacity(value: string, fallback: number): number {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? Math.round(numeric * 100) : fallback;
  }

  private readRotation(value: string): number {
    if (!value || value === 'none') return 0;
    const match = value.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
    return match ? Number(match[1]) : 0;
  }

  private readLineHeight(value: string, fallback: number): number {
    if (!value || value === 'normal') return fallback;
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private readTextAlign(value: string): HorizontalAlign {
    if (value === 'center' || value === 'right') return value;
    return 'left';
  }

  private readTextTransform(value: string): TextTransformOption {
    if (value === 'uppercase' || value === 'lowercase' || value === 'capitalize') return value;
    return 'none';
  }

  private readBlendMode(value: string): BlendMode {
    if (value === 'screen' || value === 'multiply' || value === 'overlay' || value === 'soft-light') return value;
    return 'normal';
  }

  private readObjectFit(value: string): ObjectFitOption {
    return value === 'contain' ? 'contain' : 'cover';
  }

  private parseColor(value: string, fallbackHex: string, fallbackAlpha = 100): { hex: string; alpha: number } {
    if (!value || value === 'transparent') {
      return { hex: fallbackHex, alpha: 0 };
    }

    const probe = document.createElement('div');
    probe.style.color = value;
    const normalized = probe.style.color;
    const match = normalized.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!match) {
      return { hex: this.normalizeColorInput(normalized || fallbackHex, fallbackHex), alpha: fallbackAlpha };
    }

    const [, red, green, blue, alpha] = match;
    return {
      hex: this.rgbToHex(Number(red), Number(green), Number(blue)),
      alpha: alpha ? Math.round(Number(alpha) * 100) : 100,
    };
  }

  private parseBorder(style: CSSStyleDeclaration): { hex: string; alpha: number; width: number } {
    const borderWidth = this.readPixel(style.borderWidth, 0);
    const borderColor = this.parseColor(style.borderColor, '#ffffff', 100);
    return { hex: borderColor.hex, alpha: borderColor.alpha, width: borderWidth };
  }

  private parseShadow(value: string): { enabled: boolean; hex: string; alpha: number; blur: number; offsetY: number } {
    if (!value || value === 'none') {
      return { enabled: true, hex: '#000000', alpha: 80, blur: 6, offsetY: 2 };
    }

    const match = value.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+(.+)/);
    if (!match) {
      return { enabled: true, hex: '#000000', alpha: 80, blur: 6, offsetY: 2 };
    }

    const color = this.parseColor(match[4], '#000000', 80);
    return {
      enabled: true,
      hex: color.hex,
      alpha: color.alpha,
      blur: Number(match[3]),
      offsetY: Number(match[2]),
    };
  }

  private normalizeColorInput(value: string | undefined, fallback: string): string {
    if (!value) return fallback;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
      const sanitized = value.trim();
      if (sanitized.length === 4) {
        return `#${sanitized.slice(1).split('').map((char) => char + char).join('')}`;
      }
      return sanitized.toLowerCase();
    }
    const probe = document.createElement('div');
    probe.style.color = value;
    const normalized = probe.style.color;
    const match = normalized.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return fallback;
    return this.rgbToHex(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  private rgbToHex(red: number, green: number, blue: number): string {
    return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  private toRgba(hex: string, alpha: number): string {
    const sanitized = hex.replace('#', '');
    const full = sanitized.length === 3 ? sanitized.split('').map((char) => char + char).join('') : sanitized;
    const red = Number.parseInt(full.slice(0, 2), 16);
    const green = Number.parseInt(full.slice(2, 4), 16);
    const blue = Number.parseInt(full.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(alpha, 1))})`;
  }

  private extractAdvancedCss(rawCss: string): string {
    return rawCss
      .split(';')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .filter((declaration) => {
        const separator = declaration.indexOf(':');
        if (separator === -1) return false;
        const property = declaration.slice(0, separator).trim().toLowerCase();
        return !KNOWN_CSS_PROPERTIES.has(property);
      })
      .join(';\n');
  }

  private renderTemplate(template: string, context: OverlayPreviewContext): string {
    return template
      .replaceAll('{filename}', context.filename)
      .replaceAll('{filenameNoExt}', context.filenameNoExt)
      .replaceAll('{extension}', context.extension)
      .replaceAll('{parentFolder}', context.parentFolder)
      .replaceAll('{folderPath}', context.folderPath)
      .replaceAll('{filePath}', context.filePath)
      .replaceAll('{index}', String(context.index))
      .replaceAll('{total}', String(context.total));
  }
}
