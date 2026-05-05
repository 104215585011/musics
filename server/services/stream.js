function createStreamService() {
  const clients = new Set();

  return {
    addClient(response) {
      clients.add(response);
      return () => {
        clients.delete(response);
      };
    },
    broadcast(payload) {
      const data = `data: ${JSON.stringify(payload)}\n\n`;
      for (const client of clients) {
        try {
          client.write(data);
        } catch {
          clients.delete(client);
        }
      }
    },
    clientCount() {
      return clients.size;
    },
  };
}

module.exports = {
  createStreamService,
};
