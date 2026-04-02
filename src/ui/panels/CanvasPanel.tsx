import React, { useRef, useEffect } from 'react';
import { ThreeApp } from '../../rendering/threeApp';
import { useProjectStore } from '../../state/projectStore';
import { useViewStore } from '../../state/viewStore';
import { useSelectionStore } from '../../state/selectionStore';

export const CanvasPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<ThreeApp | null>(null);

  const model = useProjectStore((s) => s.model);
  const analysisResult = useProjectStore((s) => s.analysisResult);

  const displayMode = useViewStore((s) => s.displayMode);
  const theme = useViewStore((s) => s.theme);
  const showNodeLabels = useViewStore((s) => s.showNodeLabels);
  const showMemberLabels = useViewStore((s) => s.showMemberLabels);
  const deformationScale = useViewStore((s) => s.deformationScale);
  const diagramScale = useViewStore((s) => s.diagramScale);

  const selectNode = useSelectionStore((s) => s.selectNode);
  const selectMember = useSelectionStore((s) => s.selectMember);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

  // Initialize Three.js app
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const app = new ThreeApp(container);
    appRef.current = app;

    app.onSelectionChanged = (sel) => {
      if (sel.kind === 'node') selectNode(sel.nodeId);
      else if (sel.kind === 'member') selectMember(sel.memberId);
      else clearSelection();
    };

    return () => {
      app.dispose();
      appRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update model
  useEffect(() => {
    appRef.current?.setModel(model);
  }, [model]);

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

  // Update label visibility
  useEffect(() => {
    appRef.current?.setShowNodeLabels(showNodeLabels);
  }, [showNodeLabels]);

  useEffect(() => {
    appRef.current?.setShowMemberLabels(showMemberLabels);
  }, [showMemberLabels]);

  return (
    <div
      ref={containerRef}
      className="main-canvas"
      style={{ position: 'relative', width: '100%', height: '100%' }}
    />
  );
};
