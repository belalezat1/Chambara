export default function ErrorBanner({
  message,
  visible,
}: {
  message: string;
  visible: boolean;
}) {
  return (
    <div className={`ui-error-banner${visible ? " is-visible" : ""}`} role="alert">
      <strong>⚠ ERROR</strong>
      <span>{message}</span>
    </div>
  );
}
