import { lazy, Suspense, useEffect } from 'react';
import { ConfirmHost, PromptHost, Toaster, TooltipProvider } from './ui';
import { useApp } from './lib/store';
import { useRoute } from './lib/router';
import { startUpdatePolling } from './lib/update';
import { LibraryPage } from './pages/library/LibraryPage';
import { UpdateProgress } from './pages/UpdateSection';

const EditorPage = lazy(() => import('./pages/editor/EditorPage'));

export function App() {
  const route = useRoute();
  const { loaded, load, info } = useApp();

  useEffect(() => {
    void load();
  }, [load]);

  // Updates gibt es nur in der lokalen App.
  useEffect(() => {
    if (info?.mode === 'local') startUpdatePolling();
  }, [info]);

  return (
    <TooltipProvider>
      {!loaded ? (
        <div className="boot" aria-busy="true">
          <span className="spinner" />
        </div>
      ) : route.name === 'editor' ? (
        <Suspense
          fallback={
            <div className="boot" aria-busy="true">
              <span className="spinner" />
            </div>
          }
        >
          <EditorPage key={route.id} id={route.id} initialFile={route.file} />
        </Suspense>
      ) : (
        <LibraryPage />
      )}
      <Toaster />
      <UpdateProgress />
      <ConfirmHost />
      <PromptHost />
    </TooltipProvider>
  );
}
