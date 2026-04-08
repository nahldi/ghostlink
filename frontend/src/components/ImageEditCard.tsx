interface ImageEditCardProps {
  edit: {
    mode?: string;
    prompt?: string;
    source_url?: string;
    result_url?: string;
    mask_url?: string;
    status?: string;
  };
}

function PreviewTile({ label, src }: { label: string; src?: string }) {
  if (!src) return null;
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/45">{label}</div>
      <img src={src} alt={label} className="h-[140px] w-full rounded-lg border border-outline-variant/10 object-cover" />
    </div>
  );
}

export function ImageEditCard({ edit }: ImageEditCardProps) {
  return (
    <div className="my-3 rounded-xl border border-outline-variant/12 bg-surface-container/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary/75">
            Image edit
          </div>
          <div className="mt-1 text-[12px] text-on-surface">
            {edit.mode || 'edit'}
            {edit.status ? ` | ${edit.status}` : ''}
          </div>
        </div>
      </div>

      {edit.prompt && (
        <div className="mt-3 rounded-lg border border-outline-variant/10 bg-surface-container-high/20 px-3 py-2 text-[11px] text-on-surface-variant/65">
          {edit.prompt}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3">
        <PreviewTile label="Source" src={edit.source_url} />
        <PreviewTile label="Mask" src={edit.mask_url} />
        <PreviewTile label="Result" src={edit.result_url} />
      </div>
    </div>
  );
}
