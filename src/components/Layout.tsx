import { ReactNode, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, BookOpen, Settings, Keyboard } from 'lucide-react';
import SkipToContent from './SkipToContent';
import KeyboardShortcutsPanel from './KeyboardShortcutsPanel';
import { useKeyboardShortcuts, useShortcutHelpPanel } from '@/hooks/useKeyboardShortcuts';
import { useAccessibility } from '@/hooks/useAccessibility';
import { shortcutGroups } from '@/data/shortcutGroups';

interface LayoutProps {
  children: ReactNode;
}

const tabs = [
  { path: '/', label: '使用', icon: BookOpen, shortcutKey: '1' },
  { path: '/settings', label: '设置', icon: Settings, shortcutKey: '2' },
];

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOpen: shortcutsOpen, toggle: toggleShortcuts, close: closeShortcuts } = useShortcutHelpPanel();
  const { isMotionReduced } = useAccessibility();

  // Plain number key navigation (normal priority, page shortcuts override via capture phase)
  const navShortcuts = useMemo(
    () =>
      tabs.map((tab) => ({
        key: tab.shortcutKey,
        label: tab.label,
        description: `导航到${tab.label}`,
        handler: () => navigate(tab.path),
      })),
    [navigate]
  );

  useKeyboardShortcuts(navShortcuts, 'normal');

  // Motion variants — disabled when reduce-motion is on
  const pageVariants = isMotionReduced
    ? { initial: {}, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      };

  const tabIndicatorTransition = isMotionReduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 400, damping: 30 };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SkipToContent />

      {/* Header */}
      <header
        className="sticky top-0 z-50 border-b border-border/60 bg-card/90 backdrop-blur-xl"
        role="banner"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="container flex h-12 md:h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/80 shadow-md shadow-primary/20" aria-hidden="true">
              <Mic className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">共鸣</h1>
              <p className="text-[10px] text-muted-foreground tracking-wider uppercase">Project Resonance</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-1">
            <nav className="flex items-center gap-1" role="navigation" aria-label="主导航">
              {tabs.map((tab) => {
                const isActive = location.pathname === tab.path;
                return (
                  <button
                    key={tab.path}
                    onClick={() => navigate(tab.path)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`a11y-target relative flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <tab.icon className="h-4 w-4" aria-hidden="true" />
                    {tab.label}
                    <span className="kbd-hint ml-1 hidden lg:inline-flex" aria-hidden="true">{tab.shortcutKey}</span>
                    {isActive && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute inset-0 rounded-lg bg-primary/10"
                        transition={tabIndicatorTransition}
                      />
                    )}
                  </button>
                );
              })}
            </nav>
            {/* Keyboard help toggle */}
            <button
              onClick={toggleShortcuts}
              className="a11y-target rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ml-2"
              aria-label="显示键盘快捷键帮助"
              title="键盘快捷键 (?)"
            >
              <Keyboard className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="main-content" className="flex-1" role="main" aria-label="主要内容" style={{ minHeight: '200px' }}>
        {isMotionReduced ? (
          <div className="container px-4 py-4 md:py-6 pb-2">
            {children}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              {...pageVariants}
              transition={{ duration: 0.2 }}
              className="container px-4 py-4 md:py-6 pb-2"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <nav
        className="sticky bottom-0 z-50 border-t border-border/60 bg-card/95 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        role="navigation"
        aria-label="移动端导航"
      >
        <div className="flex items-center justify-around py-1.5">
          {tabs.map((tab) => {
            const isActive = location.pathname === tab.path;
            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={tab.label}
                className={`a11y-target relative flex flex-col items-center gap-0.5 rounded-xl px-4 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground active:text-foreground'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="mobileActiveTab"
                    className="absolute inset-0 rounded-xl bg-primary/10"
                    transition={tabIndicatorTransition}
                  />
                )}
                <tab.icon className={`relative z-10 h-5 w-5 ${isActive ? 'text-primary' : ''}`} aria-hidden="true" />
                <span className="relative z-10" aria-hidden="true">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Keyboard Shortcuts Help Panel */}
      <KeyboardShortcutsPanel
        isOpen={shortcutsOpen}
        onClose={closeShortcuts}
        groups={shortcutGroups}
      />
    </div>
  );
}
