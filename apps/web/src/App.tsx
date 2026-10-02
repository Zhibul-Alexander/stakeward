import { Layout } from '@/components/layout/Layout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppRoutes } from '@/routes';

export function App() {
  return (
    <TooltipProvider>
      <Layout>
        <AppRoutes />
      </Layout>
    </TooltipProvider>
  );
}
