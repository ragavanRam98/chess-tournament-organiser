'use client';

import { useEffect } from 'react';

/** Redirect to unified /login page. */
export default function OrganizerLoginRedirect() {
  useEffect(() => { window.location.replace('/login'); }, []);
  return null;
}
