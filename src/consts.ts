// Central site configuration. Volunteers can safely edit the values here.
// One source of truth for the site name, contact details, navigation, and the
// public URL used by QR codes and the calendar feed.

export const SITE = {
  name: 'The Ridge',
  // Short, friendly tagline used in the header and metadata.
  tagline: 'A neighbourhood on the ridge, South Courtenay, BC',
  // The live site URL, the community's own domain.
  url: 'https://ourridge.ca',
  // Displayed short URL for print materials (no https:// prefix).
  displayUrl: 'ourridge.ca',
  // Group inbox, where contact/volunteer/RSVP forms send, and how neighbours reach us.
  // TODO: create this shared mailbox on the domain (see follow-up issues).
  email: 'hello@ourridge.ca',
  location: 'The Ridge, South Courtenay, British Columbia',
  // Optional social links, leave blank to hide.
  social: {
    facebook: '',
    instagram: '',
  },
} as const;

// Primary navigation, shown in the header and footer.
export const NAV: { label: string; href: string }[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Events', href: '/events' },
  { label: 'Community', href: '/community' },
  { label: 'News', href: '/news' },
  { label: 'Voice to the City', href: '/voice' },
  { label: 'Get Involved', href: '/get-involved' },
];

// Prominent call-to-action shown in the header.
export const HEADER_CTA = { label: 'Join the list', href: '/join' };
