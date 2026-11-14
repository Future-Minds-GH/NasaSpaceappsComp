// A note in Characterize's report column: what to do first, why a spot has no score, or a failed load with Try again.

export default function CharacterizeNotice({ title, children, onRetry }) {
  return (
    <div className="characterize-notice" role={onRetry ? "alert" : undefined}>
      {title && <h2 className="characterize-notice-title">{title}</h2>}
      <p>{children}</p>
      {onRetry && <button className="button button-quiet" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}
