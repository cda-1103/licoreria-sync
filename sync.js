require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  // Este ID es el de tu canal "Principal", no cambia.
  const ID_CANAL_PRINCIPAL = '688913251860c52c656c4f8d'; 
  
  // Usamos la ruta de inventario general, pidiendo 1000 productos para traer todo de un golpe
  const urlApi = 'https://api.finapartner.com/api/inventory?pageSize=1000';

  if (!process.env.FINA_TOKEN) {
    console.error("❌ ERROR: FINA_TOKEN no definido en el .env");
    return;
  }

  console.log("📡 Conectando con la API de Inventario de Fina...");

  try {
    const response = await fetch(urlApi, {
      headers: {
        'X-Access-Token': process.env.FINA_TOKEN,
        'Accept': 'application/json'
      }
    });

    const json = await response.json();
    const productosFina = json.data;

    if (!productosFina || productosFina.length === 0) {
      console.log("⚠️ No se encontraron productos en Fina.");
      return;
    }

    console.log(`📦 Encontrados ${productosFina.length} productos en el inventario.`);

    // --- PASO 1: Procesar Categorías ---
    const categoriasUnicas = new Map();
    productosFina.forEach(p => {
      const nombre = (p.category || 'Sin Categoría').trim();
      const slug = nombre.toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');

      if (!categoriasUnicas.has(slug)) {
        categoriasUnicas.set(slug, nombre);
      }
    });

    console.log(`📂 Sincronizando ${categoriasUnicas.size} categorías...`);
    const { data: finalCats, error: catError } = await supabase
      .from('categorias')
      .upsert(Array.from(categoriasUnicas).map(([slug, nombre]) => ({ nombre, slug })), { onConflict: 'slug' })
      .select();

    if (catError) throw catError;

    const catMap = {};
    finalCats.forEach(c => {
      catMap[c.nombre.toLowerCase().trim()] = c.id;
    });

    // --- PASO 2: Procesar Productos (Precios por canal y No Duplicados) ---
    const productosVistos = new Set();
    const updates = [];

    productosFina.forEach(prod => {
      // 1. Evitar duplicados por nombre
      const nombreNormalizado = prod.name.trim().toLowerCase();
      if (productosVistos.has(nombreNormalizado)) return;
      productosVistos.add(nombreNormalizado);

      // 2. Buscar el precio específico del canal Principal
      let precioCorrecto = prod.sellingPrice || 0;
      if (prod.salesChannels && prod.salesChannels.length > 0) {
        const configCanal = prod.salesChannels.find(c => c.salesChannelId === ID_CANAL_PRINCIPAL);
        if (configCanal && configCanal.sellingPrice !== undefined) {
          precioCorrecto = configCanal.sellingPrice;
        }
      }

      // 3. Obtener el ID de la categoría
      const catKey = (prod.category || 'Sin Categoría').toLowerCase().trim();
      const categoriaId = catMap[catKey] || catMap['sin categoría'];

      updates.push({
        sku: (prod.SKU && prod.SKU !== "") ? prod.SKU : prod._id,
        nombre: prod.name,
        descripcion: prod.description || '',
        precio_usd: precioCorrecto,
        stock: prod.amount || 0, // En la API de inventory el campo es 'amount'
        categoria_id: categoriaId,
        actualizado_en: new Date().toISOString()
      });
    });

    console.log(`📤 Sincronizando ${updates.length} productos únicos en Supabase...`);

    const { error: prodError } = await supabase
      .from('productos')
      .upsert(updates, { onConflict: 'sku' });

    if (prodError) throw prodError;

    console.log("✅ Sincronización exitosa con precios del canal Principal.");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
}

sincronizarTodo();