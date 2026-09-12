// Edge Function: enviar-notificacion
// Se dispara mediante Database Webhooks cuando:
//   - se inserta una fila en historial_compras (alguien registró una compra)
//   - se inserta una fila en lista_compra (alguien añadió algo a la lista)
//   - se actualiza una fila en productos (alguien editó/archivó/reactivó un producto)
//
// Avisa a todos los dispositivos del mismo hogar EXCEPTO al que hizo el cambio.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails(
  "mailto:admin@example.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const { table, type, record } = payload;

    let hogarId: string | null = null;
    let actorId: string | null = null;
    let cuerpo = "";

    if (table === "historial_compras" && type === "INSERT") {
      hogarId = record.hogar_id;
      actorId = record.comprado_por;
      const { data: producto } = await supabase
        .from("productos")
        .select("nombre")
        .eq("id", record.producto_id)
        .single();
      cuerpo = `Se registró la compra de ${record.cantidad_comprada} ${producto?.nombre ?? "un producto"}`;
    } else if (table === "lista_compra" && type === "INSERT") {
      hogarId = record.hogar_id;
      actorId = record.agregado_por;
      const { data: producto } = await supabase
        .from("productos")
        .select("nombre")
        .eq("id", record.producto_id)
        .single();
      cuerpo = `Se añadió "${producto?.nombre ?? "un producto"}" a la lista de la compra`;
    } else if (table === "productos" && type === "UPDATE") {
      hogarId = record.hogar_id;
      actorId = record.actualizado_por;
      cuerpo = `Se modificó "${record.nombre}"`;
    } else {
      return new Response("ignorado", { status: 200 });
    }

    if (!hogarId) return new Response("sin hogar_id, ignorado", { status: 200 });

    let consulta = supabase
      .from("push_subscriptions")
      .select("*")
      .eq("hogar_id", hogarId);

    if (actorId) consulta = consulta.neq("usuario_id", actorId);

    const { data: suscripciones, error } = await consulta;
    if (error) throw error;

    const mensaje = JSON.stringify({
      title: "Inventario de casa",
      body: cuerpo,
    });

    await Promise.all(
      (suscripciones ?? []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.clave_auth },
            },
            mensaje
          );
        } catch (err) {
          // Suscripción caducada/inválida (404/410): la borramos para no
          // reintentar contra un dispositivo que ya no existe.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          } else {
            console.error("Error enviando push a", sub.id, err);
          }
        }
      })
    );

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});
