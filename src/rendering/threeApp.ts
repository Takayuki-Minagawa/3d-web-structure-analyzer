import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { AnalysisResult, ProjectModel } from '../core/model/types';
import {
  isForceDiagramMode,
  type DisplayMode,
  type EditTool,
  type LabelMode,
  type Theme,
  type WorkPlaneAxis,
} from '../state/viewStore';
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CLICK_DRAG_THRESHOLD,
  MEMBER_PICK_RADIUS,
  NODE_PICK_RADIUS,
  THEME_COLORS,
} from './constants';
import { hasOpenModalDialog, pickMember, pickNode } from './interactionHelpers';
import { LabelOverlay } from './labelOverlay';
import {
  createWorkPlane,
  normalCoordinate,
  orientGrid,
  snapPosition,
  type Position3,
} from './localGeometry';
import {
  populateLoads,
  populateMembers,
  populateNodes,
  populateSupports,
  type GeometryHighlightState,
} from './modelGeometry';
import { clearGroup, disposeObject } from './resources';
import {
  createDeformationGeometry,
  populateDiagrams,
  updateDeformationGeometry,
  type DeformationGeometryState,
} from './resultGeometry';

export type ViewerSelection =
  | { kind: 'none' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'member'; memberId: string };

export type EditAction =
  | { kind: 'addNode'; x: number; y: number; z: number }
  | { kind: 'addMember'; ni: string; nj: string }
  | { kind: 'setSupport'; nodeId: string }
  | { kind: 'addNodalLoad'; nodeId: string }
  | { kind: 'addMemberLoad'; memberId: string }
  | { kind: 'moveNode'; nodeId: string; x: number; y: number; z: number }
  | { kind: 'deleteSelected' }
  | { kind: 'cancelOperation' };

export class ThreeApp {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly container: HTMLElement;
  private readonly labelOverlay: LabelOverlay;
  private readonly resizeObserver: ResizeObserver;

  private readonly nodeGroup = new THREE.Group();
  private readonly memberGroup = new THREE.Group();
  private readonly resultGroup = new THREE.Group();
  private readonly supportGroup = new THREE.Group();
  private readonly loadGroup = new THREE.Group();
  private readonly interactionGroup = new THREE.Group();
  private readonly axesHelper = new THREE.AxesHelper(200);
  private grid!: THREE.GridHelper;

  private animationId = 0;
  private pointerDownPos: { x: number; y: number } | null = null;
  private draggingNodeId: string | null = null;
  private draggingNodeOriginal: Position3 | null = null;
  private dragPreview: Position3 | null = null;
  private isDragging = false;
  private rubberBandTarget: Position3 | null = null;
  private hoveredNodeId: string | null = null;
  private hoveredMemberId: string | null = null;

  private model: ProjectModel | null = null;
  private result: AnalysisResult | null = null;
  /** Unit-normalized eigenmode shown in `modeShape` display mode. */
  private modeShape: AnalysisResult | null = null;
  private displayMode: DisplayMode = 'model';
  private deformationScale = 50;
  private modeShapeScale = 1;
  /** Bounding-box diagonal of the model nodes; the reference for mode-shape amplitude. */
  private modelExtent = 1;
  private animateDeformation = false;
  private deformationAnimationFactor = 1;
  private deformationGeometry: DeformationGeometryState | null = null;
  private diagramScale = 1;
  private gridSnap = true;
  private gridSize = 1;
  private selectedNodeIds: ReadonlySet<string> = new Set();
  private selectedMemberIds: ReadonlySet<string> = new Set();
  private isDark = false;
  private showNodeLabels = true;
  private showMemberLabels = true;
  private labelMode: LabelMode = 'auto';
  private editTool: EditTool = 'select';
  private pendingMemberStart: string | null = null;
  private workPlaneAxis: WorkPlaneAxis = 'xy';
  private workPlaneOffset = 0;

  onSelectionChanged: ((selection: ViewerSelection, multi: boolean) => void) | null = null;
  onEditAction: ((action: EditAction) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(THEME_COLORS.dark.background);

    const aspect = container.clientWidth / container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.set(500, -1000, 800);
    this.camera.up.set(0, 0, 1);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);
    this.labelOverlay = new LabelOverlay(container);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;

    this.scene.add(
      this.nodeGroup,
      this.memberGroup,
      this.resultGroup,
      this.supportGroup,
      this.loadGroup,
      this.interactionGroup,
    );
    this.createGrid();
    this.scene.add(this.axesHelper);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    this.onResize();
    this.animate();
  }

  private createGrid(): void {
    const colors = this.isDark ? THEME_COLORS.dark : THEME_COLORS.light;
    this.grid = new THREE.GridHelper(2000, 20, colors.gridCenter, colors.gridLine);
    orientGrid(this.grid, this.workPlaneAxis, this.workPlaneOffset);
    this.scene.add(this.grid);
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    if (this.animateDeformation && this.deformationGeometry) {
      this.deformationAnimationFactor = Math.sin(performance.now() / 650);
      this.updateDeformation();
    }
    this.renderer.render(this.scene, this.camera);
    this.drawLabels();
  };

  private onResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;
    const pixelRatio = window.devicePixelRatio || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.labelOverlay.resize(width, height, pixelRatio);
    // Resizing clears both canvases; redraw now instead of leaving a blank
    // frame until the next animation tick (which is throttled in hidden tabs).
    this.renderer.render(this.scene, this.camera);
    this.drawLabels();
  }

  setTheme(theme: Theme): void {
    this.isDark = theme === 'dark';
    const colors = this.isDark ? THEME_COLORS.dark : THEME_COLORS.light;
    (this.scene.background as THREE.Color).set(colors.background);
    this.scene.remove(this.grid);
    disposeObject(this.grid);
    this.createGrid();
  }

  setModel(model: ProjectModel): void {
    this.model = model;
    const bounds = new THREE.Box3();
    for (const node of model.nodes) bounds.expandByPoint(new THREE.Vector3(node.x, node.y, node.z));
    this.modelExtent = bounds.isEmpty() ? 1 : Math.max(bounds.getSize(new THREE.Vector3()).length(), 1e-9);
    this.pendingMemberStart = null;
    this.rubberBandTarget = null;
    this.hoveredNodeId = null;
    this.hoveredMemberId = null;
    this.cancelDragPreview();
    this.rebuildNodes();
    this.rebuildMembers();
    this.rebuildSupports();
    this.rebuildLoads();
    this.rebuildResults();
  }

  setResult(result: AnalysisResult | null): void {
    this.result = result;
    this.rebuildResults();
  }

  setModeShape(shape: AnalysisResult | null): void {
    this.modeShape = shape;
    if (this.displayMode === 'modeShape') this.rebuildResults();
  }

  setDisplayMode(mode: DisplayMode): void {
    if (this.displayMode === mode) return;
    this.displayMode = mode;
    this.rebuildResults();
  }

  setDeformationScale(scale: number): void {
    this.deformationScale = scale;
    this.updateDeformation();
  }

  setModeShapeScale(scale: number): void {
    this.modeShapeScale = scale;
    this.updateDeformation();
  }

  setAnimateDeformation(value: boolean): void {
    this.animateDeformation = value;
    this.deformationAnimationFactor = 1;
    this.updateDeformation();
  }

  setDiagramScale(scale: number): void {
    this.diagramScale = scale;
    if (isForceDiagramMode(this.displayMode)) this.rebuildResults();
  }

  setGridSnap(value: boolean): void {
    this.gridSnap = value;
  }

  setGridSize(value: number): void {
    this.gridSize = Math.max(value, 0.001);
  }

  setShowNodeLabels(value: boolean): void { this.showNodeLabels = value; }
  setShowMemberLabels(value: boolean): void { this.showMemberLabels = value; }
  setShowLoads(value: boolean): void { this.loadGroup.visible = value; }
  setShowSupports(value: boolean): void { this.supportGroup.visible = value; }
  setLabelMode(mode: LabelMode): void { this.labelMode = mode; }

  setWorkPlane(axis: WorkPlaneAxis, offset: number): void {
    this.workPlaneAxis = axis;
    this.workPlaneOffset = Number.isFinite(offset) ? offset : 0;
    orientGrid(this.grid, this.workPlaneAxis, this.workPlaneOffset);
    this.rubberBandTarget = null;
    this.rebuildInteractionOverlay();
  }

  setEditTool(tool: EditTool): void {
    this.editTool = tool;
    if (tool !== 'addMember') {
      this.pendingMemberStart = null;
      this.rubberBandTarget = null;
      this.rebuildNodes();
      this.rebuildInteractionOverlay();
    }
    this.updateCursor();
  }

  setSelectedIds(nodeIds: ReadonlySet<string>, memberIds: ReadonlySet<string>): void {
    this.selectedNodeIds = nodeIds;
    this.selectedMemberIds = memberIds;
    this.rebuildNodes();
    this.rebuildMembers();
  }

  fitToView(): void {
    if (!this.model || this.model.nodes.length === 0) return;
    const bounds = new THREE.Box3();
    for (const node of this.model.nodes) bounds.expandByPoint(new THREE.Vector3(node.x, node.y, node.z));
    this.frameBounds(bounds);
  }

  focusSelection(): void {
    if (!this.model) return;
    const nodeMap = new Map(this.model.nodes.map((node) => [node.id, node]));
    const bounds = new THREE.Box3();
    for (const nodeId of this.selectedNodeIds) {
      const node = nodeMap.get(nodeId);
      if (node) bounds.expandByPoint(new THREE.Vector3(node.x, node.y, node.z));
    }
    for (const memberId of this.selectedMemberIds) {
      const member = this.model.members.find((item) => item.id === memberId);
      if (!member) continue;
      const nodeI = nodeMap.get(member.ni);
      const nodeJ = nodeMap.get(member.nj);
      if (nodeI) bounds.expandByPoint(new THREE.Vector3(nodeI.x, nodeI.y, nodeI.z));
      if (nodeJ) bounds.expandByPoint(new THREE.Vector3(nodeJ.x, nodeJ.y, nodeJ.z));
    }
    if (bounds.isEmpty()) return;
    this.frameBounds(bounds);
  }

  private frameBounds(bounds: THREE.Box3): void {
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const maximumDimension = Math.max(size.x, size.y, size.z, 20);
    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-8) direction.set(1, -1.2, 0.8);
    direction.normalize();
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = maximumDimension / (2 * Math.tan(verticalFov / 2)) * 1.5;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(CAMERA_NEAR, distance / 10000);
    this.camera.far = Math.max(CAMERA_FAR, distance * 100);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  capturePngDataUrl(): string {
    this.renderer.render(this.scene, this.camera);
    this.drawLabels();
    const canvas = document.createElement('canvas');
    canvas.width = this.renderer.domElement.width;
    canvas.height = this.renderer.domElement.height;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.drawImage(this.renderer.domElement, 0, 0);
    this.labelOverlay.drawOnto(context);
    return canvas.toDataURL('image/png');
  }

  downloadPng(filename = 'frame-viewer.png'): void {
    const url = this.capturePngDataUrl();
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  }

  private get highlights(): GeometryHighlightState {
    return {
      selectedNodeIds: this.selectedNodeIds,
      selectedMemberIds: this.selectedMemberIds,
      hoveredNodeId: this.hoveredNodeId,
      hoveredMemberId: this.hoveredMemberId,
      pendingMemberStart: this.pendingMemberStart,
    };
  }

  private rebuildNodes(): void {
    clearGroup(this.nodeGroup);
    if (this.model) populateNodes(this.nodeGroup, this.model, this.highlights);
  }

  private rebuildMembers(): void {
    clearGroup(this.memberGroup);
    if (this.model) populateMembers(this.memberGroup, this.model, this.highlights);
  }

  private rebuildSupports(): void {
    clearGroup(this.supportGroup);
    if (this.model) populateSupports(this.supportGroup, this.model);
  }

  private rebuildLoads(): void {
    clearGroup(this.loadGroup);
    if (this.model) populateLoads(this.loadGroup, this.model);
  }

  private rebuildResults(): void {
    clearGroup(this.resultGroup);
    this.deformationGeometry = null;
    if (!this.model) return;
    if (this.displayMode === 'deformation' || this.displayMode === 'modeShape') {
      const source = this.displayMode === 'modeShape' ? this.modeShape : this.result;
      if (!source) return;
      this.deformationGeometry = createDeformationGeometry(this.model, source);
      if (this.deformationGeometry) {
        this.resultGroup.add(this.deformationGeometry.lines);
        this.updateDeformation();
      }
    } else if (isForceDiagramMode(this.displayMode) && this.result) {
      populateDiagrams(
        this.resultGroup,
        this.model,
        this.result,
        this.displayMode,
        this.diagramScale,
      );
    }
  }

  private updateDeformation(): void {
    if (!this.deformationGeometry) return;
    const animationFactor = this.animateDeformation ? this.deformationAnimationFactor : 1;
    // Mode shapes have a unit peak, so their scale is relative to the model
    // size: a factor of 1 draws the peak at 10 % of the extent.
    const scale = this.displayMode === 'modeShape'
      ? this.modeShapeScale * 0.1 * this.modelExtent
      : this.deformationScale;
    updateDeformationGeometry(this.deformationGeometry, scale * animationFactor);
  }

  private drawLabels(): void {
    this.labelOverlay.draw({
      model: this.model,
      result: this.result,
      camera: this.camera,
      displayMode: this.displayMode,
      diagramScale: this.diagramScale,
      isDark: this.isDark,
      showNodeLabels: this.showNodeLabels,
      showMemberLabels: this.showMemberLabels,
      labelMode: this.labelMode,
      selectedNodeIds: this.selectedNodeIds,
      selectedMemberIds: this.selectedMemberIds,
    });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDownPos = { x: event.clientX, y: event.clientY };
    this.isDragging = false;
    if (this.editTool !== 'select' || !this.model) return;
    const point = this.localPointer(event);
    const hit = this.pickNode(point.x, point.y);
    if (!hit) return;
    const node = this.model.nodes.find((item) => item.id === hit.nodeId);
    if (!node) return;
    this.draggingNodeId = node.id;
    this.draggingNodeOriginal = { x: node.x, y: node.y, z: node.z };
  };

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.localPointer(event);
    if (this.pointerDownPos && this.draggingNodeId && this.draggingNodeOriginal) {
      const dx = event.clientX - this.pointerDownPos.x;
      const dy = event.clientY - this.pointerDownPos.y;
      if (!this.isDragging && dx * dx + dy * dy > CLICK_DRAG_THRESHOLD ** 2) {
        this.isDragging = true;
        this.controls.enabled = false;
      }
      if (this.isDragging) {
        const offset = normalCoordinate(this.draggingNodeOriginal, this.workPlaneAxis);
        const preview = this.screenToPlane(point.x, point.y, this.workPlaneAxis, offset);
        if (preview) {
          this.dragPreview = preview;
          this.rebuildInteractionOverlay();
        }
        this.updateCursor();
        return;
      }
    }

    this.updateHover(point.x, point.y);
    if (this.editTool === 'addMember' && this.pendingMemberStart) {
      const nodeHit = this.pickNode(point.x, point.y);
      const targetNode = nodeHit && this.model?.nodes.find((node) => node.id === nodeHit.nodeId);
      this.rubberBandTarget = targetNode
        ? { x: targetNode.x, y: targetNode.y, z: targetNode.z }
        : this.screenToPlane(point.x, point.y, this.workPlaneAxis, this.workPlaneOffset);
      this.rebuildInteractionOverlay();
    }
  };

  private onPointerLeave = (): void => {
    if (this.isDragging) return;
    this.setHover(null, null);
    if (this.pendingMemberStart) {
      this.rubberBandTarget = null;
      this.rebuildInteractionOverlay();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.pointerDownPos) return;
    const wasDragging = this.isDragging;
    const draggedNodeId = this.draggingNodeId;
    const finalPosition = this.dragPreview;
    this.pointerDownPos = null;
    this.draggingNodeId = null;
    this.draggingNodeOriginal = null;
    this.dragPreview = null;
    this.isDragging = false;
    this.controls.enabled = true;
    this.rebuildInteractionOverlay();
    this.updateCursor();

    if (wasDragging) {
      if (draggedNodeId && finalPosition) {
        this.onEditAction?.({ kind: 'moveNode', nodeId: draggedNodeId, ...finalPosition });
      }
      return;
    }
    const point = this.localPointer(event);
    this.handleClick(point.x, point.y, event.shiftKey);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (hasOpenModalDialog()) return;
      event.preventDefault();
      this.onEditAction?.({ kind: 'deleteSelected' });
    } else if (event.key === 'Escape') {
      this.pendingMemberStart = null;
      this.rubberBandTarget = null;
      this.rebuildNodes();
      this.rebuildInteractionOverlay();
      this.onEditAction?.({ kind: 'cancelOperation' });
    }
  };

  private localPointer(event: PointerEvent): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private handleClick(x: number, y: number, multi: boolean): void {
    if (!this.model) return;
    switch (this.editTool) {
      case 'addNode': this.handleAddNode(x, y); break;
      case 'addMember': this.handleAddMember(x, y); break;
      case 'setSupport': this.handleSetSupport(x, y); break;
      case 'addNodalLoad': this.handleAddNodalLoad(x, y); break;
      case 'addMemberLoad': this.handleAddMemberLoad(x, y); break;
      case 'select': this.handleSelect(x, y, multi); break;
    }
  }

  private handleSelect(x: number, y: number, multi: boolean): void {
    const nodeHit = this.pickNode(x, y);
    const memberHit = this.pickMember(x, y);
    if (nodeHit && memberHit) {
      const nodeScore = nodeHit.distSq / NODE_PICK_RADIUS ** 2;
      const memberScore = memberHit.distSq / MEMBER_PICK_RADIUS ** 2;
      const selection: ViewerSelection = nodeScore <= memberScore
        ? { kind: 'node', nodeId: nodeHit.nodeId }
        : { kind: 'member', memberId: memberHit.memberId };
      this.onSelectionChanged?.(selection, multi);
    } else if (nodeHit) {
      this.onSelectionChanged?.({ kind: 'node', nodeId: nodeHit.nodeId }, multi);
    } else if (memberHit) {
      this.onSelectionChanged?.({ kind: 'member', memberId: memberHit.memberId }, multi);
    } else if (!multi) {
      this.onSelectionChanged?.({ kind: 'none' }, false);
    }
  }

  private handleAddNode(x: number, y: number): void {
    const position = this.screenToPlane(x, y, this.workPlaneAxis, this.workPlaneOffset);
    if (position) this.onEditAction?.({ kind: 'addNode', ...position });
  }

  private handleAddMember(x: number, y: number): void {
    const nodeHit = this.pickNode(x, y);
    if (!nodeHit) return;
    if (!this.pendingMemberStart) {
      this.pendingMemberStart = nodeHit.nodeId;
      this.onSelectionChanged?.({ kind: 'node', nodeId: nodeHit.nodeId }, false);
      this.rebuildNodes();
      this.rebuildInteractionOverlay();
      return;
    }
    if (nodeHit.nodeId !== this.pendingMemberStart) {
      this.onEditAction?.({ kind: 'addMember', ni: this.pendingMemberStart, nj: nodeHit.nodeId });
    }
    this.pendingMemberStart = null;
    this.rubberBandTarget = null;
    this.rebuildNodes();
    this.rebuildInteractionOverlay();
  }

  private handleSetSupport(x: number, y: number): void {
    const hit = this.pickNode(x, y);
    if (hit) this.onEditAction?.({ kind: 'setSupport', nodeId: hit.nodeId });
  }

  private handleAddNodalLoad(x: number, y: number): void {
    const hit = this.pickNode(x, y);
    if (hit) this.onEditAction?.({ kind: 'addNodalLoad', nodeId: hit.nodeId });
  }

  private handleAddMemberLoad(x: number, y: number): void {
    const hit = this.pickMember(x, y);
    if (hit) this.onEditAction?.({ kind: 'addMemberLoad', memberId: hit.memberId });
  }

  private pickNode(x: number, y: number): { nodeId: string; distSq: number } | null {
    if (!this.model) return null;
    return pickNode(
      this.model,
      this.camera,
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight,
      x,
      y,
      NODE_PICK_RADIUS,
    );
  }

  private pickMember(x: number, y: number): { memberId: string; distSq: number } | null {
    if (!this.model) return null;
    return pickMember(
      this.model,
      this.camera,
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight,
      x,
      y,
      MEMBER_PICK_RADIUS,
    );
  }

  private screenToPlane(
    x: number,
    y: number,
    axis: WorkPlaneAxis,
    offset: number,
  ): Position3 | null {
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    if (width <= 0 || height <= 0) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), this.camera);
    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(createWorkPlane(axis, offset), target);
    if (!hit) return null;
    return snapPosition(target, axis, offset, (value) => this.snapCoordinate(value));
  }

  private snapCoordinate(value: number): number {
    if (!this.gridSnap) return value;
    return Math.round(value / this.gridSize) * this.gridSize;
  }

  private updateHover(x: number, y: number): void {
    const nodeHit = this.pickNode(x, y);
    const memberHit = this.pickMember(x, y);
    this.setHover(nodeHit?.nodeId ?? null, nodeHit ? null : memberHit?.memberId ?? null);
  }

  private setHover(nodeId: string | null, memberId: string | null): void {
    if (this.hoveredNodeId === nodeId && this.hoveredMemberId === memberId) {
      this.updateCursor();
      return;
    }
    const nodeChanged = this.hoveredNodeId !== nodeId;
    const memberChanged = this.hoveredMemberId !== memberId;
    this.hoveredNodeId = nodeId;
    this.hoveredMemberId = memberId;
    if (nodeChanged) this.rebuildNodes();
    if (memberChanged) this.rebuildMembers();
    this.updateCursor();
  }

  private updateCursor(): void {
    let cursor = 'crosshair';
    if (this.isDragging) cursor = 'grabbing';
    else if (this.editTool === 'select' && this.hoveredNodeId) cursor = 'grab';
    else if (this.hoveredNodeId || this.hoveredMemberId) cursor = 'pointer';
    else if (this.editTool === 'select') cursor = 'default';
    this.renderer.domElement.style.cursor = cursor;
  }

  private rebuildInteractionOverlay(): void {
    clearGroup(this.interactionGroup);
    if (!this.model) return;
    const nodeMap = new Map(this.model.nodes.map((node) => [node.id, node]));
    if (this.draggingNodeId && this.dragPreview) {
      const previewPositions: number[] = [];
      for (const member of this.model.members) {
        if (member.ni !== this.draggingNodeId && member.nj !== this.draggingNodeId) continue;
        const otherId = member.ni === this.draggingNodeId ? member.nj : member.ni;
        const other = nodeMap.get(otherId);
        if (!other) continue;
        previewPositions.push(
          this.dragPreview.x, this.dragPreview.y, this.dragPreview.z,
          other.x, other.y, other.z,
        );
      }
      if (previewPositions.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(previewPositions, 3));
        this.interactionGroup.add(new THREE.LineSegments(
          geometry,
          new THREE.LineDashedMaterial({ color: 0xffaa00, dashSize: 6, gapSize: 3 }),
        ));
        const line = this.interactionGroup.children[this.interactionGroup.children.length - 1];
        if (line instanceof THREE.LineSegments) line.computeLineDistances();
      }
      const geometry = new THREE.SphereGeometry(4, 12, 8);
      const material = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
      const marker = new THREE.Mesh(geometry, material);
      marker.position.set(this.dragPreview.x, this.dragPreview.y, this.dragPreview.z);
      this.interactionGroup.add(marker);
    }

    if (this.pendingMemberStart && this.rubberBandTarget) {
      const start = nodeMap.get(this.pendingMemberStart);
      if (start) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
          start.x, start.y, start.z,
          this.rubberBandTarget.x, this.rubberBandTarget.y, this.rubberBandTarget.z,
        ], 3));
        const line = new THREE.Line(
          geometry,
          new THREE.LineDashedMaterial({ color: 0xff44cc, dashSize: 8, gapSize: 4 }),
        );
        line.computeLineDistances();
        this.interactionGroup.add(line);
      }
    }
  }

  private cancelDragPreview(): void {
    this.pointerDownPos = null;
    this.draggingNodeId = null;
    this.draggingNodeOriginal = null;
    this.dragPreview = null;
    this.isDragging = false;
    this.controls.enabled = true;
    this.rebuildInteractionOverlay();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    clearGroup(this.nodeGroup);
    clearGroup(this.memberGroup);
    clearGroup(this.resultGroup);
    clearGroup(this.supportGroup);
    clearGroup(this.loadGroup);
    clearGroup(this.interactionGroup);
    this.scene.remove(this.grid, this.axesHelper);
    disposeObject(this.grid);
    disposeObject(this.axesHelper);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelOverlay.dispose();
  }
}
