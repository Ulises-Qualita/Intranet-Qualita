// Esqueleto que muestran los loading.tsx mientras el server arma la vista. Sin él,
// al navegar la pantalla anterior queda congelada hasta que llega la página
// entera; con él, el cambio de solapa se ve al instante.
export function ViewSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando">
      <div className="topbar">
        <div>
          <div className="skel" style={{ width: 120, height: 12 }} />
          <div className="skel" style={{ width: 220, height: 26, marginTop: 10 }} />
        </div>
      </div>
      <section className="view">
        <div className="grid g4 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card kpi">
              <div className="skel" style={{ width: "55%", height: 12 }} />
              <div className="skel" style={{ width: "40%", height: 30, marginTop: 22 }} />
              <div className="skel" style={{ width: "65%", height: 11, marginTop: 14 }} />
            </div>
          ))}
        </div>
        <div className="card pad-lg">
          <div className="skel" style={{ width: 180, height: 16 }} />
          <div className="skel" style={{ width: "100%", height: 240, marginTop: 20, borderRadius: 12 }} />
        </div>
      </section>
    </div>
  );
}
