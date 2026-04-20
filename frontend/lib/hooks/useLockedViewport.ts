/**
 * useLockedViewport — verrouille `<html>` + `<body>` à la hauteur viewport
 * et coupe leur `overflow` pour la durée de vie du composant appelant.
 *
 * Pourquoi : les shells d'app (AdminDashboard, CustomerDashboard, PortalShell)
 * se construisent autour d'un root `flex h-screen overflow-hidden` qui suppose
 * que `<html>` ne scrolle jamais. Si un composant tiers (portail React, dialog,
 * overlay dev, etc.) étend le scroll area du document, l'app-shell entier se
 * met à dériver en bloc au moindre scroll → sidebar + main qui montent
 * ensemble et laissent un blanc en bas.
 *
 * Sauvegarde les valeurs inline précédentes et les restaure au démontage —
 * les pages publiques (`/signup`, `/login`, portail voyageur, onboarding…)
 * qui n'appellent PAS ce hook gardent leur scroll document natif.
 */
import { useEffect } from 'react';

export function useLockedViewport(): void {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlHeight:   html.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight:   body.style.height,
    };
    html.style.overflow = 'hidden';
    html.style.height   = '100%';
    body.style.overflow = 'hidden';
    body.style.height   = '100%';
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.height   = prev.htmlHeight;
      body.style.overflow = prev.bodyOverflow;
      body.style.height   = prev.bodyHeight;
    };
  }, []);
}
