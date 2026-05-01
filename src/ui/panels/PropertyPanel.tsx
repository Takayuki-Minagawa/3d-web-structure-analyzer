import React from 'react';
import { useProjectStore } from '../../state/projectStore';
import { useSelectionStore } from '../../state/selectionStore';
import { useViewStore } from '../../state/viewStore';
import { useT } from '../../i18n';
import type { StructuralNode, Member, NodalLoad, MemberLoad, AnalysisMode, TorsionRestraintEnd } from '../../core/model/types';
import {
  findNodesOffXzPlane,
  getAnalysisMode,
  XZ_2D_MODE,
} from '../../core/model/analysisMode';
import {
  getActiveLoadCaseId,
  getActiveLoadCombination,
  getLoadCases,
  getLoadCombinations,
} from '../../core/model/loadCases';
import { MATERIAL_PRESETS, SECTION_PRESETS } from '../../core/model/library';
import { getMemberAxisRotationDofOffset } from '../../core/model/torsionRestraint';

/** Distributive Omit that works correctly with union types */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export const PropertyPanel: React.FC = () => {
  const model = useProjectStore((s) => s.model);
  const updateNode = useProjectStore((s) => s.updateNode);
  const updateMember = useProjectStore((s) => s.updateMember);
  const addNodalLoad = useProjectStore((s) => s.addNodalLoad);
  const updateNodalLoad = useProjectStore((s) => s.updateNodalLoad);
  const removeNodalLoad = useProjectStore((s) => s.removeNodalLoad);
  const addMemberLoad = useProjectStore((s) => s.addMemberLoad);
  const updateMemberLoad = useProjectStore((s) => s.updateMemberLoad);
  const removeMemberLoad = useProjectStore((s) => s.removeMemberLoad);
  const removeNode = useProjectStore((s) => s.removeNode);
  const removeMember = useProjectStore((s) => s.removeMember);

  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const selectedMemberIds = useSelectionStore((s) => s.selectedMemberIds);

  const deformationScale = useViewStore((s) => s.deformationScale);
  const diagramScale = useViewStore((s) => s.diagramScale);
  const setDeformationScale = useViewStore((s) => s.setDeformationScale);
  const setDiagramScale = useViewStore((s) => s.setDiagramScale);
  const showNodeLabels = useViewStore((s) => s.showNodeLabels);
  const showMemberLabels = useViewStore((s) => s.showMemberLabels);
  const showLoads = useViewStore((s) => s.showLoads);
  const showSupports = useViewStore((s) => s.showSupports);
  const setShowNodeLabels = useViewStore((s) => s.setShowNodeLabels);
  const setShowMemberLabels = useViewStore((s) => s.setShowMemberLabels);
  const setShowLoads = useViewStore((s) => s.setShowLoads);
  const setShowSupports = useViewStore((s) => s.setShowSupports);

  const t = useT();

  const selectedNodes = model.nodes.filter((n) => selectedNodeIds.has(n.id));
  const selectedMembers = model.members.filter((m) => selectedMemberIds.has(m.id));
  const analysisMode = getAnalysisMode(model);

  return (
    <div className="property-panel">
      <h3>{t('prop.title')}</h3>
      <AnalysisModeEditor />

      {selectedNodes.length === 1 && (
        <NodeProperties
          node={selectedNodes[0]!}
          analysisMode={analysisMode}
          nodalLoads={model.nodalLoads.filter((l) => l.nodeId === selectedNodes[0]!.id)}
          onUpdate={updateNode}
          onDelete={removeNode}
          onAddLoad={(nodeId) => addNodalLoad({ nodeId, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 })}
          onUpdateLoad={updateNodalLoad}
          onRemoveLoad={removeNodalLoad}
        />
      )}

      {selectedMembers.length === 1 && (
        <MemberProperties
          member={selectedMembers[0]!}
          analysisMode={analysisMode}
          model={model}
          memberLoads={model.memberLoads.filter((l) => l.memberId === selectedMembers[0]!.id)}
          onUpdate={updateMember}
          onDelete={removeMember}
          onAddLoad={(memberId) =>
            addMemberLoad({
              memberId,
              type: 'udl',
              direction: analysisMode === XZ_2D_MODE ? 'localZ' : 'localY',
              value: -5,
            })
          }
          onUpdateLoad={updateMemberLoad}
          onRemoveLoad={removeMemberLoad}
        />
      )}

      {selectedNodes.length === 0 && selectedMembers.length === 0 && (
        <>
          <LoadCasesEditor />
          <MaterialsEditor />
          <SectionsEditor />
          <CouplingsEditor />
          <div className="prop-group">
            <div className="prop-title">{t('prop.displaySettings')}</div>
            <label className="checkbox-label">
              <input type="checkbox" checked={showNodeLabels} onChange={(e) => setShowNodeLabels(e.target.checked)} />
              {t('prop.nodeLabels')}
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={showMemberLabels} onChange={(e) => setShowMemberLabels(e.target.checked)} />
              {t('prop.memberLabels')}
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={showLoads} onChange={(e) => setShowLoads(e.target.checked)} />
              {t('prop.showLoads')}
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={showSupports} onChange={(e) => setShowSupports(e.target.checked)} />
              {t('prop.supports')}
            </label>
          </div>
          <div className="prop-group">
            <div className="prop-title">{t('prop.scale')}</div>
            <label>{t('prop.deformScale')} {deformationScale.toFixed(0)}</label>
            <input type="range" min="1" max="500" value={deformationScale}
              onChange={(e) => setDeformationScale(Number(e.target.value))} />
            <label>{t('prop.diagramScale')} {diagramScale.toFixed(1)}</label>
            <input type="range" min="0.1" max="10" step="0.1" value={diagramScale}
              onChange={(e) => setDiagramScale(Number(e.target.value))} />
          </div>
          <ModelSummary />
        </>
      )}
    </div>
  );
};

const NodeProperties: React.FC<{
  node: StructuralNode;
  analysisMode: AnalysisMode;
  nodalLoads: NodalLoad[];
  onUpdate: (id: string, u: Partial<Pick<StructuralNode, 'x' | 'y' | 'z' | 'restraint'>>) => void;
  onDelete: (id: string) => void;
  onAddLoad: (nodeId: string) => void;
  onUpdateLoad: (id: string, updates: Partial<Omit<NodalLoad, 'id'>>) => void;
  onRemoveLoad: (id: string) => void;
}> = ({ node, analysisMode, nodalLoads, onUpdate, onDelete, onAddLoad, onUpdateLoad, onRemoveLoad }) => {
  const t = useT();
  const model = useProjectStore((s) => s.model);
  const loadCases = getLoadCases(model);
  const restraintKeys = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const;
  const restraintLabels = {
    ux: t('prop.dirX'), uy: t('prop.dirY'), uz: t('prop.dirZ'),
    rx: t('prop.rotX'), ry: t('prop.rotY'), rz: t('prop.rotZ'),
  };

  return (
    <div className="prop-group">
      <div className="prop-title">{t('prop.node')} {node.id.substring(0, 5)}</div>
      {(['x', 'y', 'z'] as const).map((axis) => {
        const yLocked = analysisMode === XZ_2D_MODE && axis === 'y';
        return (
          <div className="prop-row" key={axis}>
            <label>{axis.toUpperCase()}:</label>
            <input type="number" value={node[axis]} step="1"
              disabled={yLocked}
              title={yLocked ? t('prop.yLockedXz2d') : undefined}
              onChange={(e) => onUpdate(node.id, { [axis]: Number(e.target.value) })} />
          </div>
        );
      })}
      <div className="prop-title">{t('prop.restraints')}</div>
      {restraintKeys.map((key) => (
        <label className="checkbox-label" key={key}>
          <input type="checkbox" checked={node.restraint[key]}
            onChange={(e) => onUpdate(node.id, { restraint: { ...node.restraint, [key]: e.target.checked } })} />
          {restraintLabels[key]}
        </label>
      ))}
      <div className="prop-title">{t('prop.nodalLoads')}</div>
      {nodalLoads.length === 0 && <div className="muted">{t('prop.noLoads')}</div>}
      {nodalLoads.map((load) => (
        <div key={load.id} className="load-item">
          <div className="prop-row">
            <label>{t('prop.loadCase')}</label>
            <select value={load.loadCaseId ?? getActiveLoadCaseId(model)}
              onChange={(e) => onUpdateLoad(load.id, { loadCaseId: e.target.value })}>
              {loadCases.map((loadCase) => (
                <option key={loadCase.id} value={loadCase.id}>{loadCase.name}</option>
              ))}
            </select>
          </div>
          {(['fx', 'fy', 'fz', 'mx', 'my', 'mz'] as const).map((f) => (
            <div className="prop-row" key={f}>
              <label>{f}:</label>
              <input type="number" value={load[f]} step="1"
                onChange={(e) => onUpdateLoad(load.id, { [f]: Number(e.target.value) })} />
            </div>
          ))}
          <button className="danger small" onClick={() => onRemoveLoad(load.id)}>{t('prop.removeLoad')}</button>
        </div>
      ))}
      <div className="prop-actions">
        <button onClick={() => onAddLoad(node.id)}>{t('prop.addLoad')}</button>
        <button className="danger" onClick={() => onDelete(node.id)}>{t('prop.delete')}</button>
      </div>
    </div>
  );
};

const AnalysisModeEditor: React.FC = () => {
  const model = useProjectStore((s) => s.model);
  const setAnalysisMode = useProjectStore((s) => s.setAnalysisMode);
  const flattenNodesToXzPlane = useProjectStore((s) => s.flattenNodesToXzPlane);
  const [error, setError] = React.useState<string | null>(null);
  const [offPlaneNodeIds, setOffPlaneNodeIds] = React.useState<string[]>([]);
  const t = useT();
  const mode = getAnalysisMode(model);

  React.useEffect(() => {
    if (error && findNodesOffXzPlane(model).length === 0) {
      setError(null);
      setOffPlaneNodeIds([]);
    }
  }, [error, model]);

  return (
    <div className="prop-group">
      <div className="prop-title">{t('prop.analysisMode')}</div>
      <div className="prop-row">
        <select
          aria-label={t('prop.analysisMode')}
          value={mode}
          onChange={(e) => {
            const result = setAnalysisMode(e.target.value as AnalysisMode);
            setError(result.ok ? null : result.error);
            setOffPlaneNodeIds(result.ok ? [] : result.nodeIds);
          }}
        >
          <option value="3d">{t('prop.analysisMode3d')}</option>
          <option value="xz2d">{t('prop.analysisModeXz2d')}</option>
        </select>
      </div>
      {error && <div className="error-text">{error}</div>}
      {offPlaneNodeIds.length > 0 && (
        <div className="prop-actions">
          <button
            onClick={() => {
              const converted = flattenNodesToXzPlane();
              const result = setAnalysisMode(XZ_2D_MODE);
              setError(result.ok ? null : result.error);
              setOffPlaneNodeIds(result.ok ? [] : converted);
            }}
          >
            {t('prop.flattenToXz2d')}
          </button>
        </div>
      )}
    </div>
  );
};

const MemberProperties: React.FC<{
  member: Member;
  analysisMode: AnalysisMode;
  model: import('../../core/model/types').ProjectModel;
  memberLoads: MemberLoad[];
  onUpdate: (id: string, u: Partial<Pick<Member, 'sectionId' | 'codeAngle' | 'torsionRestraint'>>) => void;
  onDelete: (id: string) => void;
  onAddLoad: (memberId: string) => void;
  onUpdateLoad: (id: string, updates: Partial<DistributiveOmit<MemberLoad, 'id'>>) => void;
  onRemoveLoad: (id: string) => void;
}> = ({ member, analysisMode, model, memberLoads, onUpdate, onDelete, onAddLoad, onUpdateLoad, onRemoveLoad }) => {
  const t = useT();
  const loadCases = getLoadCases(model);
  const ni = model.nodes.find((n) => n.id === member.ni);
  const nj = model.nodes.find((n) => n.id === member.nj);
  const L = ni && nj ? Math.sqrt((nj.x - ni.x) ** 2 + (nj.y - ni.y) ** 2 + (nj.z - ni.z) ** 2) : 0;
  const supportsTwistRestraint = getMemberAxisRotationDofOffset(model, member) !== null;

  return (
    <div className="prop-group">
      <div className="prop-title">{t('prop.member')} {member.id.substring(0, 5)}</div>
      <div className="prop-row"><label>{t('prop.length')}</label><span>{L.toFixed(3)}</span></div>
      <div className="prop-row">
        <label>{t('prop.section')}</label>
        <select value={member.sectionId}
          onChange={(e) => onUpdate(member.id, { sectionId: e.target.value })}>
          {model.sections.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="prop-row">
        <label>{t('prop.codeAngle')}</label>
        <input type="number" value={member.codeAngle} step="1"
          onChange={(e) => onUpdate(member.id, { codeAngle: Number(e.target.value) })} />
      </div>
      <div className="prop-row">
        <label>{t('prop.torsionRestraint')}</label>
        <select value={member.torsionRestraint ?? 'none'}
          onChange={(e) => onUpdate(member.id, { torsionRestraint: e.target.value as TorsionRestraintEnd })}>
          <option value="none">{t('prop.torsionRestraintNone')}</option>
          <option value="i" disabled={!supportsTwistRestraint}>{t('prop.torsionRestraintI')}</option>
          <option value="j" disabled={!supportsTwistRestraint}>{t('prop.torsionRestraintJ')}</option>
        </select>
      </div>
      {!supportsTwistRestraint && (
        <div className="muted">{t('prop.torsionRestraintAxisOnly')}</div>
      )}
      <div className="prop-title">{t('prop.memberLoads')}</div>
      {memberLoads.length === 0 && <div className="muted">{t('prop.noLoads')}</div>}
      {memberLoads.map((load) => (
        <div key={load.id} className="load-item">
          <div className="prop-row">
            <label>{t('prop.loadCase')}</label>
            <select value={load.loadCaseId ?? getActiveLoadCaseId(model)}
              onChange={(e) => onUpdateLoad(load.id, { loadCaseId: e.target.value })}>
              {loadCases.map((loadCase) => (
                <option key={loadCase.id} value={loadCase.id}>{loadCase.name}</option>
              ))}
            </select>
          </div>
          {load.type === 'cmq' ? (
            <>
              <div className="prop-row"><label>{t('prop.loadType')}</label><span>{t('prop.loadTypeCmq')}</span></div>
              <div className="prop-row"><label>iQx</label><input type="number" value={load.iQx} step="1" onChange={(e) => onUpdateLoad(load.id, { iQx: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>iQy</label><input type="number" value={load.iQy} step="1" onChange={(e) => onUpdateLoad(load.id, { iQy: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>iQz</label><input type="number" value={load.iQz} step="1" onChange={(e) => onUpdateLoad(load.id, { iQz: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>iMy</label><input type="number" value={load.iMy} step="1" onChange={(e) => onUpdateLoad(load.id, { iMy: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>iMz</label><input type="number" value={load.iMz} step="1" onChange={(e) => onUpdateLoad(load.id, { iMz: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>jQx</label><input type="number" value={load.jQx} step="1" onChange={(e) => onUpdateLoad(load.id, { jQx: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>jQy</label><input type="number" value={load.jQy} step="1" onChange={(e) => onUpdateLoad(load.id, { jQy: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>jQz</label><input type="number" value={load.jQz} step="1" onChange={(e) => onUpdateLoad(load.id, { jQz: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>jMy</label><input type="number" value={load.jMy} step="1" onChange={(e) => onUpdateLoad(load.id, { jMy: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>jMz</label><input type="number" value={load.jMz} step="1" onChange={(e) => onUpdateLoad(load.id, { jMz: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>moy</label><input type="number" value={load.moy} step="1" onChange={(e) => onUpdateLoad(load.id, { moy: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
              <div className="prop-row"><label>moz</label><input type="number" value={load.moz} step="1" onChange={(e) => onUpdateLoad(load.id, { moz: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} /></div>
            </>
          ) : (
            <>
              <div className="prop-row">
                <label>{t('prop.loadType')}</label>
                <select value={load.type}
                  onChange={(e) => {
                    const newType = e.target.value as 'udl' | 'point';
                    if (newType === 'point') {
                      onUpdateLoad(load.id, { type: 'point', a: 0 } as Partial<DistributiveOmit<MemberLoad, 'id'>>);
                    } else {
                      onUpdateLoad(load.id, { type: 'udl' } as Partial<DistributiveOmit<MemberLoad, 'id'>>);
                    }
                  }}>
                  <option value="udl">{t('prop.loadTypeUdl')}</option>
                  <option value="point">{t('prop.loadTypePoint')}</option>
                </select>
              </div>
              {'direction' in load && (
                <div className="prop-row">
                  <label>{t('prop.loadDirection')}</label>
                  <select value={load.direction}
                    onChange={(e) => onUpdateLoad(load.id, { direction: e.target.value as 'localX' | 'localY' | 'localZ' })}>
                    <option value="localY" disabled={analysisMode === XZ_2D_MODE}>localY</option>
                    <option value="localZ">localZ</option>
                    <option value="localX">localX</option>
                  </select>
                </div>
              )}
              {'value' in load && (
                <div className="prop-row">
                  <label>{load.type === 'udl' ? t('prop.loadIntensity') : t('prop.loadMagnitude')}</label>
                  <input type="number" value={load.value} step="1"
                    onChange={(e) => onUpdateLoad(load.id, { value: Number(e.target.value) })} />
                </div>
              )}
              {load.type === 'point' && 'a' in load && (
                <div className="prop-row">
                  <label>{t('prop.loadPosition')}</label>
                  <input type="number" value={load.a} step="0.1" min="0" max={L}
                    onChange={(e) => onUpdateLoad(load.id, { a: Number(e.target.value) } as Partial<DistributiveOmit<MemberLoad, 'id'>>)} />
                </div>
              )}
            </>
          )}
          <button className="danger small" onClick={() => onRemoveLoad(load.id)}>{t('prop.removeLoad')}</button>
        </div>
      ))}
      <div className="prop-actions">
        <button onClick={() => onAddLoad(member.id)}>{t('prop.addLoad')}</button>
        <button className="danger" onClick={() => onDelete(member.id)}>{t('prop.delete')}</button>
      </div>
    </div>
  );
};

const LoadCasesEditor: React.FC = () => {
  const model = useProjectStore((s) => s.model);
  const addLoadCase = useProjectStore((s) => s.addLoadCase);
  const updateLoadCase = useProjectStore((s) => s.updateLoadCase);
  const removeLoadCase = useProjectStore((s) => s.removeLoadCase);
  const setActiveLoadCase = useProjectStore((s) => s.setActiveLoadCase);
  const addLoadCombination = useProjectStore((s) => s.addLoadCombination);
  const updateLoadCombination = useProjectStore((s) => s.updateLoadCombination);
  const removeLoadCombination = useProjectStore((s) => s.removeLoadCombination);
  const setActiveLoadCombination = useProjectStore((s) => s.setActiveLoadCombination);
  const t = useT();

  const loadCases = getLoadCases(model);
  const loadCombinations = getLoadCombinations(model);
  const activeLoadCaseId = getActiveLoadCaseId(model);
  const activeLoadCombination = getActiveLoadCombination(model);

  return (
    <div className="prop-group">
      <div className="prop-title">{t('prop.loadCases')}</div>
      <div className="prop-row">
        <label>{t('prop.analysisTarget')}</label>
        <select
          value={activeLoadCombination ? `combo:${activeLoadCombination.id}` : `case:${activeLoadCaseId}`}
          onChange={(e) => {
            const [kind, id] = e.target.value.split(':');
            if (kind === 'combo') {
              setActiveLoadCombination(id ?? null);
            } else if (id) {
              setActiveLoadCase(id);
            }
          }}
        >
          {loadCases.map((loadCase) => (
            <option key={loadCase.id} value={`case:${loadCase.id}`}>
              {t('prop.loadCase')} {loadCase.name}
            </option>
          ))}
          {loadCombinations.map((combo) => (
            <option key={combo.id} value={`combo:${combo.id}`}>
              {t('prop.loadCombination')} {combo.name}
            </option>
          ))}
        </select>
      </div>

      {loadCases.map((loadCase) => (
        <div key={loadCase.id} className="editable-item">
          <div className="prop-row">
            <label>{t('prop.loadCase')}</label>
            <input type="text" value={loadCase.name}
              onChange={(e) => updateLoadCase(loadCase.id, { name: e.target.value })} />
          </div>
          {loadCases.length > 1 && (
            <button className="danger small" onClick={() => removeLoadCase(loadCase.id)}>
              {t('prop.removeLoadCase')}
            </button>
          )}
        </div>
      ))}

      <div className="prop-title">{t('prop.loadCombinations')}</div>
      {loadCombinations.length === 0 && <div className="muted">{t('prop.noLoadCombinations')}</div>}
      {loadCombinations.map((combo) => (
        <div key={combo.id} className="editable-item">
          <div className="prop-row">
            <label>{t('prop.loadCombination')}</label>
            <input type="text" value={combo.name}
              onChange={(e) => updateLoadCombination(combo.id, { name: e.target.value })} />
          </div>
          {loadCases.map((loadCase) => {
            const factor = combo.factors.find((term) => term.loadCaseId === loadCase.id)?.factor ?? 0;
            return (
              <div className="prop-row" key={loadCase.id}>
                <label>{loadCase.name}</label>
                <input type="number" step="0.1" value={factor}
                  onChange={(e) => {
                    const nextFactor = Number(e.target.value);
                    const otherFactors = combo.factors.filter((term) => term.loadCaseId !== loadCase.id);
                    updateLoadCombination(combo.id, {
                      factors: [...otherFactors, { loadCaseId: loadCase.id, factor: nextFactor }],
                    });
                  }} />
              </div>
            );
          })}
          <button className="danger small" onClick={() => removeLoadCombination(combo.id)}>
            {t('prop.removeLoadCombination')}
          </button>
        </div>
      ))}
      <div className="prop-actions">
        <button onClick={() => addLoadCase()}>{t('prop.addLoadCase')}</button>
        <button onClick={() => addLoadCombination()}>{t('prop.addLoadCombination')}</button>
      </div>
    </div>
  );
};

const MaterialsEditor: React.FC = () => {
  const model = useProjectStore((s) => s.model);
  const addMaterial = useProjectStore((s) => s.addMaterial);
  const updateMaterial = useProjectStore((s) => s.updateMaterial);
  const removeMaterial = useProjectStore((s) => s.removeMaterial);
  const t = useT();
  const [presetName, setPresetName] = React.useState(MATERIAL_PRESETS[0]?.name ?? '');

  const inUseIds = new Set(model.sections.map((s) => s.materialId));
  const selectedPreset = MATERIAL_PRESETS.find((preset) => preset.name === presetName) ?? MATERIAL_PRESETS[0];

  return (
    <div className="prop-group">
      <div className="prop-title">{t('prop.materials')}</div>
      {selectedPreset && (
        <div className="editable-item">
          <div className="prop-row">
            <label>{t('prop.library')}</label>
            <select value={presetName} onChange={(e) => setPresetName(e.target.value)}>
              {MATERIAL_PRESETS.map((preset) => (
                <option key={preset.name} value={preset.name}>{preset.name}</option>
              ))}
            </select>
          </div>
          <button className="small" onClick={() => addMaterial({ ...selectedPreset })}>
            {t('prop.addFromLibrary')}
          </button>
        </div>
      )}
      {model.materials.map((mat) => (
        <div key={mat.id} className="editable-item">
          <div className="prop-row">
            <label>{t('prop.matName')}</label>
            <input type="text" value={mat.name}
              onChange={(e) => updateMaterial(mat.id, { name: e.target.value })} />
          </div>
          <div className="prop-row">
            <label>{t('prop.matE')}</label>
            <input type="number" value={mat.E} step="100"
              onChange={(e) => updateMaterial(mat.id, { E: Number(e.target.value) })} />
          </div>
          <div className="prop-row">
            <label>{t('prop.matG')}</label>
            <input type="number" value={mat.G} step="100"
              onChange={(e) => updateMaterial(mat.id, { G: Number(e.target.value) })} />
          </div>
          <div className="prop-row">
            <label>{t('prop.matNu')}</label>
            <input type="number" value={mat.nu} step="0.01" min="0" max="0.5"
              onChange={(e) => updateMaterial(mat.id, { nu: Number(e.target.value) })} />
          </div>
          {!inUseIds.has(mat.id) && (
            <button className="danger small" onClick={() => removeMaterial(mat.id)}>
              {t('prop.removeMaterial')}
            </button>
          )}
        </div>
      ))}
      <div className="prop-actions">
        <button onClick={() => addMaterial({ name: 'New', E: 20500, G: 7900, nu: 0.3, expansion: 0 })}>
          {t('prop.addMaterial')}
        </button>
      </div>
    </div>
  );
};

const SectionsEditor: React.FC = () => {
  const model = useProjectStore((s) => s.model);
  const addSection = useProjectStore((s) => s.addSection);
  const updateSection = useProjectStore((s) => s.updateSection);
  const removeSection = useProjectStore((s) => s.removeSection);
  const t = useT();
  const [presetName, setPresetName] = React.useState(SECTION_PRESETS[0]?.name ?? '');

  const inUseIds = new Set(model.members.map((m) => m.sectionId));
  const matId = model.materials[0]?.id ?? '';
  const selectedPreset = SECTION_PRESETS.find((preset) => preset.name === presetName) ?? SECTION_PRESETS[0];

  return (
    <div className="prop-group">
      <div className="prop-title">{t('prop.sections')}</div>
      {selectedPreset && (
        <div className="editable-item">
          <div className="prop-row">
            <label>{t('prop.library')}</label>
            <select value={presetName} onChange={(e) => setPresetName(e.target.value)}>
              {SECTION_PRESETS.map((preset) => (
                <option key={preset.name} value={preset.name}>{preset.name}</option>
              ))}
            </select>
          </div>
          <button className="small" disabled={!matId}
            onClick={() => addSection({ ...selectedPreset, materialId: matId })}>
            {t('prop.addFromLibrary')}
          </button>
        </div>
      )}
      {model.sections.map((sec) => (
        <div key={sec.id} className="editable-item">
          <div className="prop-row">
            <label>{t('prop.secName')}</label>
            <input type="text" value={sec.name}
              onChange={(e) => updateSection(sec.id, { name: e.target.value })} />
          </div>
          <div className="prop-row">
            <label>{t('prop.secA')}</label>
            <input type="number" value={sec.A} step="1"
              onChange={(e) => updateSection(sec.id, { A: Number(e.target.value) })} />
          </div>
          <div className="prop-row">
            <label>{t('prop.secIx')}</label>
            <input type="number" value={sec.Ix} step="1"
              onChange={(e) => updateSection(sec.id, { Ix: Number(e.target.value) })} />
          </div>
          <div className="prop-row">
            <label>{t('prop.secIy')}</label>
            <input type="number" value={sec.Iy} step="1"
              onChange={(e) => updateSection(sec.id, { Iy: Number(e.target.value) })} />
          </div>
          <div className="prop-row">
            <label>{t('prop.secIz')}</label>
            <input type="number" value={sec.Iz} step="1"
              onChange={(e) => updateSection(sec.id, { Iz: Number(e.target.value) })} />
          </div>
          {!inUseIds.has(sec.id) && (
            <button className="danger small" onClick={() => removeSection(sec.id)}>
              {t('prop.removeSection')}
            </button>
          )}
        </div>
      ))}
      <div className="prop-actions">
        <button onClick={() => addSection({ name: 'New', materialId: matId, A: 100, Ix: 1000, Iy: 500, Iz: 500, ky: 0, kz: 0 })}>
          {t('prop.addSection')}
        </button>
      </div>
    </div>
  );
};

const CouplingsEditor: React.FC = () => {
  const model = useProjectStore((s) => s.model);
  const addCoupling = useProjectStore((s) => s.addCoupling);
  const updateCoupling = useProjectStore((s) => s.updateCoupling);
  const removeCoupling = useProjectStore((s) => s.removeCoupling);

  const couplings = model.couplings ?? [];
  const nodeOptions = model.nodes.map(n => n.id);
  const dofKeys = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const;

  return (
    <div className="prop-group">
      <div className="prop-title">Coupling</div>
      {couplings.length === 0 && <div className="muted">No couplings</div>}
      {couplings.map((c) => (
        <div key={c.id} className="editable-item">
          <div className="prop-row">
            <label>Master:</label>
            <select value={c.masterNodeId}
              onChange={(e) => updateCoupling(c.id, { masterNodeId: e.target.value })}>
              {nodeOptions.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div className="prop-row">
            <label>Slave:</label>
            <select value={c.slaveNodeId}
              onChange={(e) => updateCoupling(c.id, { slaveNodeId: e.target.value })}>
              {nodeOptions.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
            {dofKeys.map(k => (
              <label className="checkbox-label" key={k} style={{ fontSize: '0.85em' }}>
                <input type="checkbox" checked={c[k]}
                  onChange={(e) => updateCoupling(c.id, { [k]: e.target.checked })} />
                {k}
              </label>
            ))}
          </div>
          <button className="danger small" onClick={() => removeCoupling(c.id)}>Remove</button>
        </div>
      ))}
      <div className="prop-actions">
        <button onClick={() => {
          const n0 = nodeOptions[0] ?? '';
          const n1 = nodeOptions[1] ?? n0;
          addCoupling({ masterNodeId: n0, slaveNodeId: n1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
        }}>
          Add Coupling
        </button>
      </div>
    </div>
  );
};

const ModelSummary: React.FC = () => {
  const model = useProjectStore((s) => s.model);
  const analysisError = useProjectStore((s) => s.analysisError);
  const analysisResult = useProjectStore((s) => s.analysisResult);
  const isResultStale = useProjectStore((s) => s.isResultStale);
  const t = useT();

  return (
    <div className="prop-group">
      <div className="prop-title">{t('prop.modelInfo')}</div>
      <div className="prop-row"><label>{t('prop.nodeCount')}</label><span>{model.nodes.length}</span></div>
      <div className="prop-row"><label>{t('prop.memberCount')}</label><span>{model.members.length}</span></div>
      <div className="prop-row"><label>{t('prop.nodalLoadCount')}</label><span>{model.nodalLoads.length}</span></div>
      <div className="prop-row"><label>{t('prop.memberLoadCount')}</label><span>{model.memberLoads.length}</span></div>
      {isResultStale && analysisResult && (
        <div className="warning-text">{t('prop.staleWarning')}</div>
      )}
      {analysisError && (
        <div className="error-text">{analysisError.message}</div>
      )}
    </div>
  );
};
