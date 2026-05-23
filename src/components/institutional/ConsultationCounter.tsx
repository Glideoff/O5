import { useInstitutionalStore } from "../../stores/institutionalStore";

export function ConsultationCounter() {
  const n = useInstitutionalStore((s) => s.consultationsThisMonth);
  return (
    <span className="consultation-counter" title="Statistiques agrégées — non modifiables">
      CONSULTATIONS CE MOIS : {n}
    </span>
  );
}
