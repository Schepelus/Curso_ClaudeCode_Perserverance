// Mini "TelemetryAPI" con el mismo patrón que Open MCT
// (openmct/src/api/telemetry/TelemetryAPI.js):
//  - Cada canal es un objeto con nombre, unidad y una ficha `telemetry.values`
//    que dice qué campo es el eje X (hints.domain) y cuál el eje Y (hints.range).
//  - Los proveedores se registran con addProvider y dicen qué canales atienden
//    (supportsRequest / supportsSubscribe), igual que en Open MCT.
//  - request() pide el historial y subscribe() recibe cada dato nuevo.

export function createTelemetryAPI() {
  const channels = new Map();
  const requestProviders = [];
  const subscriptionProviders = [];

  return {
    addChannel(channel) {
      channels.set(channel.key, channel);
      return channel;
    },

    getChannels() {
      return [...channels.values()];
    },

    addProvider(provider) {
      if (provider.supportsRequest) requestProviders.unshift(provider);
      if (provider.supportsSubscribe) subscriptionProviders.unshift(provider);
    },

    // Devuelve la ficha del canal: qué valor es el dominio (X) y cuál el rango (Y).
    getMetadata(channel) {
      const values = channel.telemetry.values;
      return {
        values,
        domain: values.find((v) => v.hints?.domain),
        range: values.find((v) => v.hints?.range),
      };
    },

    async request(channel, options = {}) {
      const provider = requestProviders.find((p) => p.supportsRequest(channel));
      if (!provider) throw new Error(`Ningún proveedor sabe dar el historial de "${channel.name}"`);
      return provider.request(channel, options);
    },

    subscribe(channel, callback) {
      const provider = subscriptionProviders.find((p) => p.supportsSubscribe(channel));
      return provider ? provider.subscribe(channel, callback) : () => {};
    },
  };
}
