import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { ThreeApp } from '../../rendering/threeApp';
import type { EditAction } from '../../rendering/threeApp';
import { useProjectStore } from '../../state/projectStore';
import { isForceDiagramMode, useViewStore } from '../../state/viewStore';
import { modeShapeAsResult } from '../../state/analysisResults';
import { formatEngineering } from '../../core/formatEngineering';
import { useSelectionStore } from '../../state/selectionStore';
import {
  getAnalysisMode,
  getDefaultMemberLoadDirectionForMode,
} from '../../core/model/analysisMode';
import {
  FIXED_RESTRAINT,
  FREE_RESTRAINT,
  PINNED_RESTRAINT,
  restraintPresetName,
} from '../../core/model/restraints';
import { useT } from '../../i18n';


interface CaptureRequestDetail {
  resolve: (dataUrl: string) => void;
}

export const CanvasPanel: React.FC = () => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<ThreeApp | null>(null);
  const [nodeCoordinates, setNodeCoordinates] = useState({ x: '0', y: '0', z: '0' });

  const model = useProjectStore((s) => s.model);
  const analysisResult = useProjectStore((s) => s.analysisResult);
  const isResultStale = useProjectStore((s) => s.isResultStale);
  const modalResult = useProjectStore((s) => s.modalResult);
  const bucklingResult = useProjectStore((s) => s.bucklingResult);
  const fitViewVersion = useProjectStore((s) => s.fitViewVersion);
  const addNode = useProjectStore((s) => s.addNode);
  const addMember = useProjectStore((s) => s.addMember);
  const updateNode = useProjectStore((s) => s.updateNode);
  const removeNode = useProjectStore((s) => s.removeNode);
  const removeMember = useProjectStore((s) => s.removeMember);
  const addNodalLoad = useProjectStore((s) => s.addNodalLoad);
  const addMemberLoad = useProjectStore((s) => s.addMemberLoad);

  const displayMode = useViewStore((s) => s.displayMode);
  const editTool = useViewStore((s) => s.editTool);
  const theme = useViewStore((s) => s.theme);
  const showNodeLabels = useViewStore((s) => s.showNodeLabels);
  const showMemberLabels = useViewStore((s) => s.showMemberLabels);
  const showLoads = useViewStore((s) => s.showLoads);
  const showSupports = useViewStore((s) => s.showSupports);
  const animateDeformation = useViewStore((s) => s.animateDeformation);
  const gridSnap = useViewStore((s) => s.gridSnap);
  const gridSize = useViewStore((s) => s.gridSize);
  const deformationScale = useViewStore((s) => s.deformationScale);
  const modeShapeScale = useViewStore((s) => s.modeShapeScale);
  const diagramScale = useViewStore((s) => s.diagramScale);
  const labelMode = useViewStore((s) => s.labelMode);
  const workPlaneAxis = useViewStore((s) => s.workPlaneAxis);
  const workPlaneOffset = useViewStore((s) => s.workPlaneOffset);
  const shapeView = useViewStore((s) => s.shapeView);
  const setDisplayMode = useViewStore((s) => s.setDisplayMode);
  const setShowNodeLabels = useViewStore((s) => s.setShowNodeLabels);
  const setShowMemberLabels = useViewStore((s) => s.setShowMemberLabels);
  const setShowLoads = useViewStore((s) => s.setShowLoads);
  const setShowSupports = useViewStore((s) => s.setShowSupports);
  const setLabelMode = useViewStore((s) => s.setLabelMode);
  const setGridSnap = useViewStore((s) => s.setGridSnap);
  const setGridSize = useViewStore((s) => s.setGridSize);
  const setAnimateDeformation = useViewStore((s) => s.setAnimateDeformation);
  const setDeformationScale = useViewStore((s) => s.setDeformationScale);
  const setModeShapeScale = useViewStore((s) => s.setModeShapeScale);
  const setDiagramScale = useViewStore((s) => s.setDiagramScale);
  const setWorkPlaneAxis = useViewStore((s) => s.setWorkPlaneAxis);
  const setWorkPlaneOffset = useViewStore((s) => s.setWorkPlaneOffset);

  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const selectedMemberIds = useSelectionStore((s) => s.selectedMemberIds);
  const selectNode = useSelectionStore((s) => s.selectNode);
  const selectMember = useSelectionStore((s) => s.selectMember);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const focusVersion = useSelectionStore((s) => s.focusVersion);
  const requestFocusSelection = useSelectionStore((s) => s.focusSelection);

  const handleEditAction = useCallback((action: EditAction) => {
    switch (action.kind) {
      case 'addNode': {
        const id = addNode(action.x, action.y, action.z);
        selectNode(id);
        break;
      }
      case 'addMember': {
        const id = addMember(action.ni, action.nj);
        selectMember(id);
        break;
      }
      case 'setSupport': {
        const node = useProjectStore.getState().model.nodes.find(n => n.id === action.nodeId);
        if (!node) break;
        const preset = restraintPresetName(node.restraint);
        const next = preset === 'free' ? PINNED_RESTRAINT : preset === 'pin' ? FIXED_RESTRAINT : FREE_RESTRAINT;
        updateNode(action.nodeId, { restraint: { ...next } });
        selectNode(action.nodeId);
        break;
      }
      case 'addNodalLoad':
        addNodalLoad({ nodeId: action.nodeId, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 });
        selectNode(action.nodeId);
        break;
      case 'addMemberLoad': {
        const currentModel = useProjectStore.getState().model;
        const direction = getDefaultMemberLoadDirectionForMode(
          currentModel,
          action.memberId,
          getAnalysisMode(currentModel)
        );
        addMemberLoad({ memberId: action.memberId, type: 'udl', direction, value: -5 });
        selectMember(action.memberId);
        break;
      }
      case 'moveNode':
        updateNode(action.nodeId, { x: action.x, y: action.y, z: action.z });
        break;
      case 'deleteSelected': {
        const nodeIds = useSelectionStore.getState().selectedNodeIds;
        const memberIds = useSelectionStore.getState().selectedMemberIds;
        for (const id of memberIds) removeMember(id);
        for (const id of nodeIds) removeNode(id);
        clearSelection();
        break;
      }
      case 'cancelOperation':
        clearSelection();
        break;
    }
  }, [addNode, addMember, updateNode, removeNode, removeMember, addNodalLoad, addMemberLoad, selectNode, selectMember, clearSelection]);

  const addNodeFromCoordinates = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const x = Number(nodeCoordinates.x);
    const y = Number(nodeCoordinates.y);
    const z = Number(nodeCoordinates.z);
    if (![x, y, z].every(Number.isFinite)) return;
    const id = addNode(x, y, z);
    selectNode(id);
  }, [addNode, nodeCoordinates, selectNode]);

  // Initialize Three.js app
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const app = new ThreeApp(container);
    appRef.current = app;

    app.onSelectionChanged = (sel, multi) => {
      if (sel.kind === 'node') selectNode(sel.nodeId, multi);
      else if (sel.kind === 'member') selectMember(sel.memberId, multi);
      else clearSelection();
    };

    app.onEditAction = handleEditAction;

    return () => {
      app.dispose();
      appRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update edit tool
  useEffect(() => {
    appRef.current?.setEditTool(editTool);
  }, [editTool]);

  useEffect(() => {
    setNodeCoordinates((current) => {
      if (workPlaneAxis === 'xy') return { ...current, z: String(workPlaneOffset) };
      if (workPlaneAxis === 'xz') return { ...current, y: String(workPlaneOffset) };
      return { ...current, x: String(workPlaneOffset) };
    });
  }, [workPlaneAxis, workPlaneOffset]);

  // Keep edit action callback in sync
  useEffect(() => {
    if (appRef.current) appRef.current.onEditAction = handleEditAction;
  }, [handleEditAction]);

  // Update model
  useEffect(() => {
    appRef.current?.setModel(model);
  }, [model]);

  // Fit to view when a whole-model load occurs (import, sample, reset)
  const prevFitVersion = useRef(fitViewVersion);
  useEffect(() => {
    if (fitViewVersion !== prevFitVersion.current) {
      prevFitVersion.current = fitViewVersion;
      appRef.current?.fitToView();
    }
  }, [fitViewVersion]);

  // Results from before a model edit would be drawn on the wrong geometry.
  const currentResult = isResultStale ? null : analysisResult;
  useEffect(() => {
    appRef.current?.setResult(currentResult);
  }, [currentResult]);

  // Selected eigenmode, as long as its analysis still matches the model.
  const selectedMode = useMemo(() => {
    if (!shapeView) return null;
    const source = shapeView.kind === 'modal' ? modalResult : bucklingResult;
    if (!source || source.sourceModel !== model) return null;
    const mode = source.modes[shapeView.index];
    if (!mode) return null;
    const value = 'frequency' in mode
      ? `${formatEngineering(mode.frequency)} Hz`
      : `λ = ${formatEngineering(mode.loadFactor)}`;
    return {
      result: modeShapeAsResult(mode.shape),
      caption: `${t(shapeView.kind === 'modal' ? 'results.modal' : 'results.buckling')} ${mode.index}: ${value}`,
    };
  }, [shapeView, modalResult, bucklingResult, model, t]);
  const modeShapeResult = selectedMode?.result ?? null;
  useEffect(() => {
    appRef.current?.setModeShape(modeShapeResult);
  }, [modeShapeResult]);

  // Update display mode
  useEffect(() => {
    appRef.current?.setDisplayMode(displayMode);
  }, [displayMode]);

  // Update theme
  useEffect(() => {
    appRef.current?.setTheme(theme);
  }, [theme]);

  // Update scales
  useEffect(() => {
    appRef.current?.setDeformationScale(deformationScale);
  }, [deformationScale]);

  useEffect(() => {
    appRef.current?.setModeShapeScale(modeShapeScale);
  }, [modeShapeScale]);

  useEffect(() => {
    appRef.current?.setDiagramScale(diagramScale);
  }, [diagramScale]);

  // Sync selection highlight from selectionStore to ThreeApp
  useEffect(() => {
    appRef.current?.setSelectedIds(selectedNodeIds, selectedMemberIds);
  }, [selectedNodeIds, selectedMemberIds]);

  // Update label visibility
  useEffect(() => {
    appRef.current?.setShowNodeLabels(showNodeLabels);
  }, [showNodeLabels]);

  useEffect(() => {
    appRef.current?.setShowMemberLabels(showMemberLabels);
  }, [showMemberLabels]);

  useEffect(() => {
    appRef.current?.setLabelMode(labelMode);
  }, [labelMode]);

  useEffect(() => {
    appRef.current?.setShowLoads(showLoads);
  }, [showLoads]);

  useEffect(() => {
    appRef.current?.setShowSupports(showSupports);
  }, [showSupports]);

  useEffect(() => {
    appRef.current?.setAnimateDeformation(animateDeformation);
  }, [animateDeformation]);

  useEffect(() => {
    appRef.current?.setGridSnap(gridSnap);
  }, [gridSnap]);

  useEffect(() => {
    appRef.current?.setGridSize(gridSize);
  }, [gridSize]);

  useEffect(() => {
    appRef.current?.setWorkPlane(workPlaneAxis, workPlaneOffset);
  }, [workPlaneAxis, workPlaneOffset]);

  const previousFocusVersion = useRef(focusVersion);
  useEffect(() => {
    if (focusVersion === previousFocusVersion.current) return;
    previousFocusVersion.current = focusVersion;
    appRef.current?.focusSelection();
  }, [focusVersion]);

  useEffect(() => {
    const handleScreenshot = () => appRef.current?.downloadPng();
    const handleCaptureRequest = (event: Event) => {
      const detail = (event as CustomEvent<CaptureRequestDetail>).detail;
      const app = appRef.current;
      if (app && typeof detail?.resolve === 'function') detail.resolve(app.capturePngDataUrl());
    };
    window.addEventListener('frame-viewer:screenshot', handleScreenshot);
    window.addEventListener('frame-viewer:capture-request', handleCaptureRequest);
    return () => {
      window.removeEventListener('frame-viewer:screenshot', handleScreenshot);
      window.removeEventListener('frame-viewer:capture-request', handleCaptureRequest);
    };
  }, []);

  return (
    <div className="canvas-stage">
      <div ref={containerRef} className="main-canvas" />

      {editTool === 'addNode' && (
        <form className="canvas-coordinate-form" onSubmit={addNodeFromCoordinates} aria-label={t('canvas.addNodeAria')}>
          <strong>{t('canvas.addNode')}</strong>
          {(['x', 'y', 'z'] as const).map((axis) => (
            <label key={axis}>
              {axis.toUpperCase()}
              <input
                type="number"
                step="any"
                value={nodeCoordinates[axis]}
                onChange={(event) => setNodeCoordinates((current) => ({ ...current, [axis]: event.target.value }))}
              />
            </label>
          ))}
          <button type="submit">{t('canvas.add')}</button>
        </form>
      )}

      <details className="canvas-palette" open>
        <summary>{t('canvas.palette')}</summary>
        <div className="canvas-palette-content">
          <label>
            {t('canvas.display')}
            <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as typeof displayMode)}>
              <option value="model">{t('display.model')}</option>
              <option value="deformation">{t('display.deformation')}</option>
              <option value="modeShape">{t('display.modeShape')}</option>
              {(['N', 'Vy', 'Vz', 'Mx', 'My', 'Mz'] as const).map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </label>
          <div className="canvas-palette-checks">
            <label><input type="checkbox" checked={showNodeLabels} onChange={(event) => setShowNodeLabels(event.target.checked)} />{t('prop.nodeLabels')}</label>
            <label><input type="checkbox" checked={showMemberLabels} onChange={(event) => setShowMemberLabels(event.target.checked)} />{t('prop.memberLabels')}</label>
            <label><input type="checkbox" checked={showLoads} onChange={(event) => setShowLoads(event.target.checked)} />{t('prop.showLoads')}</label>
            <label><input type="checkbox" checked={showSupports} onChange={(event) => setShowSupports(event.target.checked)} />{t('prop.supports')}</label>
          </div>
          <label>
            {t('canvas.labelMode')}
            <select value={labelMode} onChange={(event) => setLabelMode(event.target.value as typeof labelMode)}>
              <option value="auto">{t('canvas.labelAuto')}</option>
              <option value="all">{t('canvas.labelAll')}</option>
              <option value="selected">{t('canvas.labelSelected')}</option>
            </select>
          </label>
          {displayMode === 'modeShape' && (
            <div className="muted">{selectedMode?.caption ?? t('canvas.modeShapeHint')}</div>
          )}
          {(displayMode === 'deformation' || displayMode === 'modeShape') && (
            <>
              <label className="canvas-palette-toggle">
                <span>{t('canvas.animateDeformation')}</span>
                <input type="checkbox" checked={animateDeformation} onChange={(event) => setAnimateDeformation(event.target.checked)} />
              </label>
              {displayMode === 'deformation' ? (
                <label>
                  {t('prop.deformScale')}
                  <input type="number" min="0" step="1" value={deformationScale} onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value)) setDeformationScale(Math.max(0, value));
                  }} />
                </label>
              ) : (
                <label>
                  {t('canvas.modeShapeScale')}
                  <input type="number" min="0" step="0.5" value={modeShapeScale} onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value)) setModeShapeScale(value);
                  }} />
                </label>
              )}
            </>
          )}
          {isForceDiagramMode(displayMode) && (
            <label>
              {t('prop.diagramScale')}
              <input type="number" min="0" step="0.1" value={diagramScale} onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value)) setDiagramScale(Math.max(0, value));
              }} />
            </label>
          )}
          <div className="canvas-palette-row">
            <label>
              {t('canvas.workPlane')}
              <select value={workPlaneAxis} onChange={(event) => setWorkPlaneAxis(event.target.value as typeof workPlaneAxis)}>
                <option value="xy">XY</option>
                <option value="xz">XZ</option>
                <option value="yz">YZ</option>
              </select>
            </label>
            <label>
              {t('canvas.offset')}
              <input type="number" step="any" value={workPlaneOffset} onChange={(event) => setWorkPlaneOffset(event.target.valueAsNumber)} />
            </label>
          </div>
          <div className="canvas-palette-row">
            <label><input type="checkbox" checked={gridSnap} onChange={(event) => setGridSnap(event.target.checked)} />{t('canvas.snap')}</label>
            <label>
              {t('canvas.spacing')}
              <input type="number" min="0.001" step="any" value={gridSize} onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value)) setGridSize(value);
              }} />
            </label>
          </div>
          <button type="button" onClick={requestFocusSelection} disabled={selectedNodeIds.size + selectedMemberIds.size === 0}>{t('canvas.focusSelection')}</button>
        </div>
      </details>
    </div>
  );
};
