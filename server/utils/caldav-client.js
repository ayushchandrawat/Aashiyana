// --------------------------------------------------------

//

// VTODO-Outbound (caldav-todo-outbound.js) sprechen denselben Server mit


// CalDAV-Account eingerichtet hat, soll ihn nie laden.
// --------------------------------------------------------

/**
 * @param {{caldav_url: string, username: string, password: string}} account
 * @returns {Promise<object>} tsdav-Client
 */
export async function createCalDAVClient(account) {
  const { createDAVClient } = await import('tsdav');
  const client = await createDAVClient({
    serverUrl:          account.caldav_url,
    credentials:        { username: account.username, password: account.password },
    authMethod:         'Basic',
    defaultAccountType: 'caldav',
  });
  return withCalendarObjectUrlFilter(client);
}

function urlParts(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, 'http://caldav.invalid/');
    return { path: parsed.pathname, search: parsed.search };
  } catch { return { path: raw, search: '' }; }
}

export function calendarObjectUrlFilter(collectionUrl) {


  const identity = (parts) => `${parts.path.replace(/\/+$/, '')}${parts.search}`;
  const collectionParts = urlParts(collectionUrl);
  const collection = collectionParts ? identity(collectionParts) : '';
  return (url) => {
    const parts = urlParts(url);
    if (!parts || !parts.path) return false;


    if (parts.path.endsWith('/') && !parts.search) return false;
    return identity(parts) !== collection;
  };
}

export function withCalendarObjectUrlFilter(client) {
  const fetchCalendarObjects = client.fetchCalendarObjects.bind(client);



  // die Klassenform (`new DAVClient()`) wechselt, deren Methoden am Prototyp



  return Object.create(Object.getPrototypeOf(client), {
    ...Object.getOwnPropertyDescriptors(client),
    fetchCalendarObjects: {
      value: (params = {}) => fetchCalendarObjects({
        urlFilter: calendarObjectUrlFilter(params?.calendar?.url),
        ...params,
      }),
      writable: true, enumerable: true, configurable: true,
    },
  });
}

export function supportsComponent(cal, component) {
  const comps = Array.isArray(cal?.components) ? cal.components : [];
  if (comps.length === 0) return true;
  return comps.map(c => String(c).toUpperCase()).includes(String(component).toUpperCase());
}

export function collectionUrlOf(objectUrl) {
  const url = String(objectUrl || '');
  const cut = url.lastIndexOf('/');
  return cut === -1 ? null : url.slice(0, cut + 1);
}
