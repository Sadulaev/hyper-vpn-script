export function buildVlessLinkFromServerConfig(server, { id, clientName }) {
  const host = server.publicHost;
  const port = Number(server.publicPort ?? 443);

  const params = new URLSearchParams();
  params.set('type', 'tcp');
  params.set('encryption', 'none');
  params.set('security', server.security);
  params.set('pbk', server.pbk);
  params.set('fp', server.fp);
  params.set('sni', server.sni);
  params.set('sid', server.sid);
  params.set('spx', server.spx);

  // const remark = encodeURIComponent(clientName);
  return `vless://${id}@${host}:${port}?${params.toString()}%2F#HyperVPN-${server.id}`;
}

// возвращает epoch (секунды) с запасом в 1 день
export function msExpiryEpochPlusOneDay(months) {
  const now = new Date();
  now.setMonth(now.getMonth() + months);
  now.setDate(now.getDate() + 1); // +1 день для сообщения продления
  return Math.floor(now.getTime()); // миллисекунды
}

// вернуть первый самый оптимальный сервер из списка
export function chooseBestServer(serversData) {
  if (serversData.length === 0) return null;

  console.log(serversData);

  let finalServer = serversData.find((server) => server.currentUsers < server.usersLimit);

  if(!finalServer) {
    finalServer = serversData.reduce((acc, server) => {
      if(!acc) return server;

      if(server.currentUsers < acc.currentUsers) return server;

      return acc;
    }, null)
  }

  return finalServer;

  // return serversData.reduce((acc, server) => {
  //   if(acc.id) {
  //     if(server.currentUsers < server.usersLimit) {
  //       if(acc.currentUsers >= acc.usersLimit && server.currentUsers < acc.currentUsers) {
  //         return { id: server.id, currentUsers: server.currentUsers, usersLimit: server.usersLimit, firstInboundId: server.firstInboundId };
  //       } else {
  //         return acc;
  //       }
  //     } else {
  //       if(server.currentUsers < acc.currentUsers) {
  //         return { id: server.id, currentUsers: server.currentUsers, usersLimit: server.usersLimit, firstInboundId: server.firstInboundId };
  //       } else {
  //         return acc;
  //       }
  //     }
  //   } else {
  //     return { id: server.id, currentUsers: server.currentUsers, usersLimit: server.usersLimit, firstInboundId: server.firstInboundId };
  //   }
    
    
    
  //   // if (server.currentUsers < server.usersLimit) {
  //   //   if (acc.id && server.currentUsers < acc.currentUsers) {
  //   //     return { id: server.id, currentUsers: server.currentUsers, firstInboundId: server.firstInboundId }; // новый лучший (меньше юзеров и не превышен лимит)
  //   //   }
  //   // } else if (!acc.id || server.currentUsers < acc.currentUsers) {
  //   //   return { id: server.id, currentUsers: server.currentUsers, firstInboundId: server.firstInboundId }; // у всех превышен лимит, выбираем с наименьшим числом юзеров
  //   // }
  //   // return acc;
  // }, { id: null, currentUsers: 0, usersLimit: 0, firstInboundId: null });
};