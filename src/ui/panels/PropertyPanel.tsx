import React from 'react';
import { useProjectStore } from '../../state/projectStore';
import { useSelectionStore } from '../../state/selectionStore';
import { useViewStore } from '../../state/viewStore';
import type { StructuralNode, Member, NodalLoad, MemberLoad } from '../../core/model/types';

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

  const selectedNodes = model.nodes.filter((n) => selectedNodeIds.has(n.id));
  const selectedMembers = model.members.filter((m) => selectedMemberIds.has(m.id));

  return (
    <div className="property-panel">
      <h3>プロパティ</h3>

      {selectedNodes.length === 1 && (
        <NodeProperties
          node={selectedNodes[0]!}
          nodalLoads={model.nodalLoads.filter((l) => l.nodeId === selectedNodes[0]!.id)}
          onUpdate={updateNode}
          onDelete={removeNode}
          onAddLoad={(nodeId) => addNodalLoad({ nodeId, fx: 0, fy: -10, mz: 0 })}
          onUpdateLoad={updateNodalLoad}
          onRemoveLoad={removeNodalLoad}
        />
      )}

      {selectedMembers.length === 1 && (
        <MemberProperties
          member={selectedMembers[0]!}
          model={model}
          memberLoads={model.memberLoads.filter((l) => l.memberId === selectedMembers[0]!.id)}
          onUpdate={updateMember}
          onDelete={removeMember}
          onAddLoad={(memberId) =>
            addMemberLoad({ memberId, type: 'udl', direction: 'localY', value: -5 })
          }
          onUpdateLoad={updateMemberLoad}
          onRemoveLoad={removeMemberLoad}
        />
      )}

      {selectedNodes.length === 0 && selectedMembers.length === 0 && (
        <>
          <div className="prop-group">
            <div className="prop-title">表示設定</div>
            <label className="checkbox-label">
              <input type="checkbox" checked={showNodeLabels} onChange={(e) => setShowNodeLabels(e.target.checked)} />
              節点番号
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={showMemberLabels} onChange={(e) => setShowMemberLabels(e.target.checked)} />
              部材番号
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={showLoads} onChange={(e) => setShowLoads(e.target.checked)} />
              荷重表示
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={showSupports} onChange={(e) => setShowSupports(e.target.checked)} />
              支持条件
            </label>
          </div>
          <div className="prop-group">
            <div className="prop-title">スケール</div>
            <label>変形倍率: {deformationScale.toFixed(0)}</label>
            <input
              type="range"
              min="1"
              max="500"
              value={deformationScale}
              onChange={(e) => setDeformationScale(Number(e.target.value))}
            />
            <label>断面力倍率: {diagramScale.toFixed(1)}</label>
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={diagramScale}
              onChange={(e) => setDiagramScale(Number(e.target.value))}
            />
          </div>
          <ModelSummary />
        </>
      )}
    </div>
  );
};

const NodeProperties: React.FC<{
  node: StructuralNode;
  nodalLoads: NodalLoad[];
  onUpdate: (id: string, u: Partial<Pick<StructuralNode, 'x' | 'y' | 'restraint'>>) => void;
  onDelete: (id: string) => void;
  onAddLoad: (nodeId: string) => void;
  onUpdateLoad: (id: string, updates: Partial<Omit<NodalLoad, 'id'>>) => void;
  onRemoveLoad: (id: string) => void;
}> = ({ node, nodalLoads, onUpdate, onDelete, onAddLoad, onUpdateLoad, onRemoveLoad }) => {
  return (
    <div className="prop-group">
      <div className="prop-title">節点 {node.id.substring(0, 5)}</div>
      <div className="prop-row">
        <label>X:</label>
        <input
          type="number"
          value={node.x}
          step="0.1"
          onChange={(e) => onUpdate(node.id, { x: Number(e.target.value) })}
        />
      </div>
      <div className="prop-row">
        <label>Y:</label>
        <input
          type="number"
          value={node.y}
          step="0.1"
          onChange={(e) => onUpdate(node.id, { y: Number(e.target.value) })}
        />
      </div>
      <div className="prop-title">拘束条件</div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={node.restraint.ux}
          onChange={(e) =>
            onUpdate(node.id, { restraint: { ...node.restraint, ux: e.target.checked } })
          }
        />
        X方向 (ux)
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={node.restraint.uy}
          onChange={(e) =>
            onUpdate(node.id, { restraint: { ...node.restraint, uy: e.target.checked } })
          }
        />
        Y方向 (uy)
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={node.restraint.rz}
          onChange={(e) =>
            onUpdate(node.id, { restraint: { ...node.restraint, rz: e.target.checked } })
          }
        />
        回転 (rz)
      </label>
      {nodalLoads.length > 0 && (
        <>
          <div className="prop-title">節点荷重</div>
          {nodalLoads.map((load) => (
            <div key={load.id} className="load-item">
              <div className="prop-row">
                <label>Fx:</label>
                <input
                  type="number"
                  value={load.fx}
                  step="1"
                  onChange={(e) => onUpdateLoad(load.id, { fx: Number(e.target.value) })}
                />
              </div>
              <div className="prop-row">
                <label>Fy:</label>
                <input
                  type="number"
                  value={load.fy}
                  step="1"
                  onChange={(e) => onUpdateLoad(load.id, { fy: Number(e.target.value) })}
                />
              </div>
              <div className="prop-row">
                <label>Mz:</label>
                <input
                  type="number"
                  value={load.mz}
                  step="1"
                  onChange={(e) => onUpdateLoad(load.id, { mz: Number(e.target.value) })}
                />
              </div>
              <button className="danger small" onClick={() => onRemoveLoad(load.id)}>荷重削除</button>
            </div>
          ))}
        </>
      )}
      <div className="prop-actions">
        <button onClick={() => onAddLoad(node.id)}>荷重追加</button>
        <button className="danger" onClick={() => onDelete(node.id)}>削除</button>
      </div>
    </div>
  );
};

const MemberProperties: React.FC<{
  member: Member;
  model: import('../../core/model/types').ProjectModel;
  memberLoads: MemberLoad[];
  onUpdate: (id: string, u: Partial<Pick<Member, 'materialId' | 'sectionId'>>) => void;
  onDelete: (id: string) => void;
  onAddLoad: (memberId: string) => void;
  onUpdateLoad: (id: string, updates: Partial<Omit<MemberLoad, 'id'>>) => void;
  onRemoveLoad: (id: string) => void;
}> = ({ member, model, memberLoads, onUpdate, onDelete, onAddLoad, onUpdateLoad, onRemoveLoad }) => {
  const ni = model.nodes.find((n) => n.id === member.ni);
  const nj = model.nodes.find((n) => n.id === member.nj);
  const L = ni && nj ? Math.sqrt((nj.x - ni.x) ** 2 + (nj.y - ni.y) ** 2) : 0;

  return (
    <div className="prop-group">
      <div className="prop-title">部材 {member.id.substring(0, 5)}</div>
      <div className="prop-row">
        <label>長さ:</label>
        <span>{L.toFixed(3)} m</span>
      </div>
      <div className="prop-row">
        <label>材料:</label>
        <select
          value={member.materialId}
          onChange={(e) => onUpdate(member.id, { materialId: e.target.value })}
        >
          {model.materials.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>
      <div className="prop-row">
        <label>断面:</label>
        <select
          value={member.sectionId}
          onChange={(e) => onUpdate(member.id, { sectionId: e.target.value })}
        >
          {model.sections.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      {memberLoads.length > 0 && (
        <>
          <div className="prop-title">部材荷重</div>
          {memberLoads.map((load) => (
            <div key={load.id} className="load-item">
              <div className="prop-row">
                <label>種類:</label>
                <select
                  value={load.type}
                  onChange={(e) => {
                    const newType = e.target.value as 'udl' | 'point';
                    if (newType === 'point') {
                      onUpdateLoad(load.id, { type: 'point', a: 0 } as Partial<Omit<MemberLoad, 'id'>>);
                    } else {
                      onUpdateLoad(load.id, { type: 'udl' } as Partial<Omit<MemberLoad, 'id'>>);
                    }
                  }}
                >
                  <option value="udl">等分布</option>
                  <option value="point">集中</option>
                </select>
              </div>
              <div className="prop-row">
                <label>方向:</label>
                <select
                  value={load.direction}
                  onChange={(e) => onUpdateLoad(load.id, { direction: e.target.value as 'localX' | 'localY' })}
                >
                  <option value="localY">localY</option>
                  <option value="localX">localX</option>
                </select>
              </div>
              <div className="prop-row">
                <label>{load.type === 'udl' ? '強度:' : '大きさ:'}</label>
                <input
                  type="number"
                  value={load.value}
                  step="1"
                  onChange={(e) => onUpdateLoad(load.id, { value: Number(e.target.value) })}
                />
              </div>
              {load.type === 'point' && (
                <div className="prop-row">
                  <label>位置 a:</label>
                  <input
                    type="number"
                    value={load.a}
                    step="0.1"
                    min="0"
                    max={L}
                    onChange={(e) => onUpdateLoad(load.id, { a: Number(e.target.value) })}
                  />
                </div>
              )}
              <button className="danger small" onClick={() => onRemoveLoad(load.id)}>荷重削除</button>
            </div>
          ))}
        </>
      )}
      <div className="prop-actions">
        <button onClick={() => onAddLoad(member.id)}>荷重追加</button>
        <button className="danger" onClick={() => onDelete(member.id)}>削除</button>
      </div>
    </div>
  );
};

const ModelSummary: React.FC = () => {
  const model = useProjectStore((s) => s.model);
  const analysisResult = useProjectStore((s) => s.analysisResult);
  const analysisError = useProjectStore((s) => s.analysisError);
  const isResultStale = useProjectStore((s) => s.isResultStale);

  return (
    <div className="prop-group">
      <div className="prop-title">モデル情報</div>
      <div className="prop-row"><label>節点:</label><span>{model.nodes.length}</span></div>
      <div className="prop-row"><label>部材:</label><span>{model.members.length}</span></div>
      <div className="prop-row"><label>節点荷重:</label><span>{model.nodalLoads.length}</span></div>
      <div className="prop-row"><label>部材荷重:</label><span>{model.memberLoads.length}</span></div>
      {isResultStale && analysisResult && (
        <div className="warning-text">結果が古くなっています。再解析してください。</div>
      )}
      {analysisError && (
        <div className="error-text">{analysisError.message}</div>
      )}
    </div>
  );
};
