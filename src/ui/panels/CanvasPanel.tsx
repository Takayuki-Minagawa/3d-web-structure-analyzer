import React, { useRef, useEffect, useCallback } from 'react';
import { CanvasRenderer } from '../../rendering/canvasApp';
import { useProjectStore } from '../../state/projectStore';
import { useViewStore } from '../../state/viewStore';
import { useSelectionStore } from '../../state/selectionStore';

export const CanvasPanel: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const isDragging = useRef(false);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const dragNodeId = useRef<string | null>(null);
  const memberStartNode = useRef<string | null>(null);

  const model = useProjectStore((s) => s.model);
  const analysisResult = useProjectStore((s) => s.analysisResult);
  const addNode = useProjectStore((s) => s.addNode);
  const updateNode = useProjectStore((s) => s.updateNode);
  const addMember = useProjectStore((s) => s.addMember);
  const removeNode = useProjectStore((s) => s.removeNode);
  const removeMember = useProjectStore((s) => s.removeMember);
  const addNodalLoad = useProjectStore((s) => s.addNodalLoad);
  const addMemberLoad = useProjectStore((s) => s.addMemberLoad);

  const editTool = useViewStore((s) => s.editTool);
  const displayMode = useViewStore((s) => s.displayMode);
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

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;

    // Center viewport
    const rect = canvas.getBoundingClientRect();
    renderer.viewport.offsetX = rect.width / 2;
    renderer.viewport.offsetY = rect.height / 2;
    renderer.resize();

    const handleResize = () => {
      renderer.resize();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Render loop
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.resize();
    renderer.render(model, analysisResult, {
      displayMode,
      showNodeLabels,
      showMemberLabels,
      showLoads,
      showSupports,
      deformationScale,
      diagramScale,
      selectedNodeIds,
      selectedMemberIds,
    });
  }, [
    model,
    analysisResult,
    displayMode,
    showNodeLabels,
    showMemberLabels,
    showLoads,
    showSupports,
    deformationScale,
    diagramScale,
    selectedNodeIds,
    selectedMemberIds,
  ]);

  const getMousePos = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };


  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getMousePos(e);
    const renderer = rendererRef.current;
    if (!renderer) return;

    lastMouse.current = { x, y };

    // Middle button or space: start pan
    if (e.button === 1) {
      isPanning.current = true;
      return;
    }

    if (e.button !== 0) return;

    if (editTool === 'select') {
      const hitNode = renderer.findNodeAt(x, y, model.nodes);
      if (hitNode) {
        selectNode(hitNode.id, e.shiftKey);
        isDragging.current = true;
        dragNodeId.current = hitNode.id;
        return;
      }
      const hitMember = renderer.findMemberAt(x, y, model);
      if (hitMember) {
        selectMember(hitMember.id, e.shiftKey);
        return;
      }
      clearSelection();
    } else if (editTool === 'addNode') {
      const [mx, my] = renderer.screenToModel(x, y);
      const snappedX = Math.round(mx * 10) / 10;
      const snappedY = Math.round(my * 10) / 10;
      const id = addNode(snappedX, snappedY);
      selectNode(id);
    } else if (editTool === 'addMember') {
      const hitNode = renderer.findNodeAt(x, y, model.nodes);
      if (hitNode) {
        if (memberStartNode.current === null) {
          memberStartNode.current = hitNode.id;
          selectNode(hitNode.id);
        } else {
          if (memberStartNode.current !== hitNode.id) {
            const id = addMember(memberStartNode.current, hitNode.id);
            selectMember(id);
          }
          memberStartNode.current = null;
        }
      }
    } else if (editTool === 'setSupport') {
      const hitNode = renderer.findNodeAt(x, y, model.nodes);
      if (hitNode) {
        // Cycle: free -> pin -> fix -> roller -> free
        const { ux, uy, rz } = hitNode.restraint;
        if (!ux && !uy && !rz) {
          updateNode(hitNode.id, { restraint: { ux: true, uy: true, rz: false } });
        } else if (ux && uy && !rz) {
          updateNode(hitNode.id, { restraint: { ux: true, uy: true, rz: true } });
        } else if (ux && uy && rz) {
          updateNode(hitNode.id, { restraint: { ux: false, uy: true, rz: false } });
        } else {
          updateNode(hitNode.id, { restraint: { ux: false, uy: false, rz: false } });
        }
        selectNode(hitNode.id);
      }
    } else if (editTool === 'addNodalLoad') {
      const hitNode = renderer.findNodeAt(x, y, model.nodes);
      if (hitNode) {
        addNodalLoad({ nodeId: hitNode.id, fx: 0, fy: -10, mz: 0 });
        selectNode(hitNode.id);
      }
    } else if (editTool === 'addMemberLoad') {
      const hitMember = renderer.findMemberAt(x, y, model);
      if (hitMember) {
        addMemberLoad({ memberId: hitMember.id, type: 'udl', direction: 'localY', value: -5 });
        selectMember(hitMember.id);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getMousePos(e);
    const renderer = rendererRef.current;
    if (!renderer) return;

    const dx = x - lastMouse.current.x;
    const dy = y - lastMouse.current.y;

    if (isPanning.current) {
      renderer.viewport.offsetX += dx;
      renderer.viewport.offsetY += dy;
      lastMouse.current = { x, y };
      renderer.render(model, analysisResult, {
        displayMode,
        showNodeLabels,
        showMemberLabels,
        showLoads,
        showSupports,
        deformationScale,
        diagramScale,
        selectedNodeIds,
        selectedMemberIds,
      });
      return;
    }

    if (isDragging.current && dragNodeId.current && editTool === 'select') {
      const [mx, my] = renderer.screenToModel(x, y);
      const snappedX = Math.round(mx * 10) / 10;
      const snappedY = Math.round(my * 10) / 10;
      updateNode(dragNodeId.current, { x: snappedX, y: snappedY });
    }

    lastMouse.current = { x, y };
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    isPanning.current = false;
    dragNodeId.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const { x, y } = getMousePos(e as unknown as React.MouseEvent);
    const [mx, my] = renderer.screenToModel(x, y);

    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    renderer.viewport.scale *= factor;

    // Adjust offset so the point under cursor stays fixed
    const [newSx, newSy] = renderer.modelToScreen(mx, my);
    renderer.viewport.offsetX += x - newSx;
    renderer.viewport.offsetY += y - newSy;

    renderer.render(model, analysisResult, {
      displayMode,
      showNodeLabels,
      showMemberLabels,
      showLoads,
      showSupports,
      deformationScale,
      diagramScale,
      selectedNodeIds,
      selectedMemberIds,
    });
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore key events when focus is on an input or select element
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        for (const id of selectedNodeIds) removeNode(id);
        for (const id of selectedMemberIds) removeMember(id);
        clearSelection();
      }
      if (e.key === 'Escape') {
        memberStartNode.current = null;
        clearSelection();
      }
    },
    [selectedNodeIds, selectedMemberIds, removeNode, removeMember, clearSelection]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <canvas
      ref={canvasRef}
      className="main-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
};
