import Html from '@kitajs/html';

export interface LayoutProps {
  title: string;
  children: string | JSX.Element;
}

export function Layout({ title, children }: LayoutProps): string {
  return (
    <>
      {'<!DOCTYPE html>'}
      <html>
        <head>
          <title>{title}</title>
        </head>
        <body>{Html.contentsToString([children])}</body>
      </html>
    </>
  ) as string;
}
