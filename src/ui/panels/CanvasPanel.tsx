import React, { useRef, useEffect, useCallback } from 'react';
import { ThreeApp } from '../../rendering/threeApp';
import type { EditAction } from '../../rendering/threeApp';
import { useProjectStore } from '../../state/projectStore';
import { useViewStore } from '../../state/viewStore';
import { useSelectionStore } from '../../state/selectionStore';
import {
  getAnalysisMode,
  getDefaultMemberLoadDirectionForMode,
} from '../../core/model/analysisMode';

const FIXED_RESTRAINT = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const FREE_RESTRAINT = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };

export const CanvasPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<ThreeApp | null>(null);

  const model = useProjectStore((s) => s.model);
  const analysisResult = useProjectStore((s) => s.analysisResult);
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
  const deformationScale = useViewStore((s) => s.deformationScale);
  const diagramScale = useViewStore((s) => s.diagramScale);

  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const selectedMemberIds = useSelectionStore((s) => s.selectedMemberIds);
  const selectNode = useSelectionStore((s) => s.selectNode);
  const selectMember = useSelectionStore((s) => s.selectMember);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

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
        const isFixed = node.restraint.ux && node.restraint.uy && node.restraint.uz;
        updateNode(action.nodeId, { restraint: isFixed ? FREE_RESTRAINT : FIXED_RESTRAINT });
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

  // Update results
  useEffect(() => {
    appRef.current?.setResult(analysisResult);
  }, [analysisResult]);

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
    appRef.current?.setShowLoads(showLoads);
  }, [showLoads]);

  useEffect(() => {
    appRef.current?.setShowSupports(showSupports);
  }, [showSupports]);

  return (
    <div
      ref={containerRef}
      className="main-canvas"
      style={{ position: 'relative', width: '100%', height: '100%' }}
    />
  );
};
