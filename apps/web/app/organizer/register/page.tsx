'use client';

import { useEffect } from 'react';

/** Redirect to unified /register page. */
export default function OrganizerRegisterRedirect() {
  useEffect(() => { window.location.replace('/register'); }, []);
  return null;
}
