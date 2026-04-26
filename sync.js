require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  if (!process.env.FINA_TOKEN) {
    console.error("❌ ERROR: FINA_TOKEN no definido.");
    return;
  }

  // URL con filtros. Prueba cambiar hideOutOfStock=false si sigue saliendo vacío.
  const urlApi = 'https://api.finapartner.com/api/pos/sales/69ee728889942f65ea447c4e?hideOutOfStock=true&location=local';

  console.log("📡 Conectando con la API de Fina...");

  try {
    const response = await fetch(urlApi, {
      headers: {
        'X-Access-Token': process.env.FINA_TOKEN,
        'Accept': 'application/json',
        'Origin': 'https://bbtiendadelicores.finapartner.com',
        'Referer': 'https://bbtiendadelicores.finapartner.com/'
      }
    });

    const json = await response.json();

    // --- BLOQUE DE DIAGNÓSTICO ---
    const productosFina = json.data?.salesChannel?.products;

    if (!productosFina || productosFina.length === 0) {
      console.log("⚠️ No se encontraron productos en el path esperado.");
      console.log("🔍 ESTRUCTURA RECIBIDA:");
      console.log(JSON.stringify(json, null, 2)); // Esto nos dirá qué está enviando Fina realmente
      return;
    }
    // --- FIN BLOQUE DE DIAGNÓSTICO ---

    console.log(`📦 Procesando ${productosFina.length} productos...`);

    const currentChannelId = json.data?.sale?.salesChannel?._id;
    const categoriasUnicas = new Map();
    
    productosFina.forEach(p => {
      const nombre = (p.category && p.category.trim() !== "") ? p.category.trim() : 'Sin Categoría';
      const slug = nombre.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!categoriasUnicas.has(slug)) categoriasUnicas.set(slug, nombre);
    });

    const arrayCategorias = Array.from(categoriasUnicas).map(([slug, nombre]) => ({ nombre, slug }));
    const { data: finalCats, error: catError } = await supabase.from('categorias').upsert(arrayCategorias, { onConflict: 'slug' }).select();
    if (catError) throw catError;

    const catMap = {};
    finalCats.forEach(c => { catMap[c.nombre.toLowerCase().trim()] = c.id; });

    const productosVistos = new Set();
    const updates = [];

    productosFina.forEach(prod => {
      const nombreNormalizado = prod.name.trim().toLowerCase();
      if (productosVistos.has(nombreNormalizado)) return;
      productosVistos.add(nombreNormalizado);

      let precioCorrecto = prod.sellingPrice || 0;
      if (currentChannelId && prod.salesChannels) {
        const configCanal = prod.salesChannels.find(c => c.salesChannelId === currentChannelId);
        if (configCanal && configCanal.sellingPrice !== undefined) {
          precioCorrecto = configCanal.sellingPrice;
        }
      }

      updates.push({
        sku: (prod.SKU && prod.SKU !== "") ? prod.SKU : prod._id,
        nombre: prod.name,
        descripcion: prod.description || '',
        precio_usd: precioCorrecto,
        stock: prod.totalStock || 0,
        categoria_id: catMap[(prod.category || 'Sin Categoría').toLowerCase().trim()] || catMap['sin categoría'],
        actualizado_en: new Date().toISOString()
      });
    });

    const { error: prodError } = await supabase.from('productos').upsert(updates, { onConflict: 'sku' });
    if (prodError) throw prodError;

    console.log("✅ Sincronización exitosa.");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
}

sincronizarTodo();