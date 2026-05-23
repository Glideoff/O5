import { useEffect } from "react";
import { useInstitutionalStore } from "../../stores/institutionalStore";
import "../../styles/institutional.css";

export function DocumentHeader() {
  const meta = useInstitutionalStore((s) => s.documentMeta);
  const ensureDocumentMeta = useInstitutionalStore((s) => s.ensureDocumentMeta);

  useEffect(() => {
    ensureDocumentMeta();
  }, [ensureDocumentMeta]);

  if (!meta) return null;

  return (
    <header className="doc-header">
      <div className="doc-header__row">
        <span className="doc-header__label">RÉF. DOCUMENT</span>
        <span className="doc-header__value"> : {meta.ref}</span>
      </div>
      <div className="doc-header__row">
        <span className="doc-header__label">CLASSIFICATION</span>
        <span className="doc-header__value"> : {meta.classification}</span>
      </div>
      <div className="doc-header__row">
        <span className="doc-header__label">DATE CRÉATION</span>
        <span className="doc-header__value"> : {meta.created}</span>
      </div>
      <div className="doc-header__row">
        <span className="doc-header__label">PRÉPARÉ PAR</span>
        <span className="doc-header__value"> : {meta.prepared}</span>
      </div>
      <div className="doc-header__row">
        <span className="doc-header__label">APPROUVÉ PAR</span>
        <span className="doc-header__value"> : {meta.approved}</span>
      </div>
      <div className="doc-header__row">
        <span className="doc-header__label">DISTRIBUTION</span>
        <span className="doc-header__value"> : {meta.distribution}</span>
      </div>
      <div className="doc-header__rule" />
    </header>
  );
}
