/**
 * Tabs — Onglets accessibles (Radix Tabs), style TransLog
 *
 * Usage :
 *   <Tabs defaultValue="info">
 *     <TabsList>
 *       <TabsTrigger value="info">Informations</TabsTrigger>
 *       <TabsTrigger value="sec">Sécurité</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="info">…</TabsContent>
 *     <TabsContent value="sec">…</TabsContent>
 *   </Tabs>
 *
 * Style : underline vert (Tailwind emerald-500) sur l'onglet actif,
 * cohérent avec l'identité visuelle du dashboard (boutons primaires,
 * badges "Actif"…).
 */
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'flex items-center gap-6 border-b border-slate-200 dark:border-slate-800',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative px-1 pb-2.5 pt-1 text-sm font-medium transition-colors',
      'text-slate-500 hover:text-slate-700',
      'dark:text-slate-400 dark:hover:text-slate-200',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 rounded-sm',
      'data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400',
      // Underline actif
      'after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5',
      'after:bg-transparent data-[state=active]:after:bg-emerald-500',
      'after:transition-colors',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'pt-5 focus-visible:outline-none',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';
