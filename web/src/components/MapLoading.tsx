interface Props {
  mapName: string;
  error: string | null;
  slow: boolean;
  onRetry: () => void;
}

/** Shown in place of the map while its data loads, with a way out if the network misbehaves. */
export default function MapLoading({ mapName, error, slow, onRetry }: Props) {
  return (
    <div className="map-wrap">
      <div className="map-loading">
        {error ? (
          <div className="load-msg">
            <b>Couldn't load {mapName}</b>
            <span>{error}. Check your connection and try again.</span>
            <button className="btn primary" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <div className="load-msg">
            <span className="spinner" aria-hidden />
            <span>Loading {mapName}…</span>
            {slow && (
              <>
                <span className="muted-s">This is taking longer than usual (slow connection?).</span>
                <button className="btn" onClick={onRetry}>
                  Retry
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
