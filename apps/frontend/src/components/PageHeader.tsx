export default function PageHeader(props: { title: string; subtitle?: string }) {
  const { title, subtitle } = props;
  return (
    <header className="page-header">
      <h2 className="page-title">{title}</h2>
      {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
    </header>
  );
}
