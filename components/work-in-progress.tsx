// Cartel de "en proceso" para una solapa que todavía no está hecha: una grúa de
// obra dibujada en línea (pedido del usuario, después de probar una caricatura de
// alguien en su compu), que sube y baja un bloque (.wip en globals.css). No
// muestra datos; solo avisa que la sección viene en camino.
export function WorkInProgress({ title }: { title: string }) {
  return (
    <section className="view">
      <div className="card wip">
        <svg className="wip-art" viewBox="0 0 240 180" role="img" aria-label="Una grúa de construcción levantando un bloque">
          <defs>
            <clipPath id="wip-under-jib">
              <rect x="0" y="47" width="240" height="133" />
            </clipPath>
          </defs>
          <g fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {/* Piso y bloques ya puestos */}
            <path d="M18 168h204" />
            <path d="M142 168v-18h18v18M160 150h18v18" />

            {/* Torre */}
            <path d="M70 168V52M86 168V52" />
            <path d="M70 168l16-20-16-20 16-20-16-20 16-20-16-16" />
            <path d="M60 168h36" />

            {/* Cabina, punta y tensores */}
            <rect x="64" y="38" width="28" height="14" rx="2" />
            <path d="M78 38V14" />
            <path d="M78 14l112 24M78 14L36 38" />

            {/* Pluma y contrapeso */}
            <path d="M92 38h106v8H92" />
            <path d="M92 46l9-8 9 8 9-8 9 8 9-8 9 8 9-8 9 8 9-8 9 8 9-8 8 8" />
            <path d="M64 42H30" />
            <rect x="30" y="42" width="18" height="14" rx="2" />
          </g>

          {/* Cable y carga: suben y bajan; lo que pasa de la pluma se recorta */}
          <g clipPath="url(#wip-under-jib)">
            <g className="wip-load" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M169 0v100" stroke="var(--muted)" />
              <path d="M169 100l-9 10M169 100l9 10" stroke="var(--muted)" />
              <rect x="160" y="110" width="18" height="18" stroke="var(--magenta)" />
            </g>
          </g>
        </svg>
        <span className="wip-tag">En proceso</span>
        <h3>{title} está en construcción</h3>
        <p>IT ya está trabajando en esta sección.</p>
      </div>
    </section>
  );
}
